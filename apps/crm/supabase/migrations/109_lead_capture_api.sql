-- ============================================================
-- MIGRATION 109: Lead Capture API
-- ------------------------------------------------------------
-- Cria infraestrutura para captura de leads via API publica
-- (formulários externos, landing pages, ads).
--
-- Tabelas novas:
--   api_keys          — chaves de autenticacao (hash SHA-256)
--   capture_sources   — origens de captura (site, LP, parceiro)
--   inbound_requests  — log de idempotencia
--
-- Alteracoes:
--   leads             — +capture_source_id, +utm_source/medium/campaign/term/content
--
-- Funcao:
--   consume_api_key_rate_limit(p_key_hash) — atomic check + increment
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. api_keys
-- ------------------------------------------------------------
CREATE TABLE public.api_keys (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  -- SHA-256 da chave completa. Nunca armazenamos o valor real.
  key_hash            TEXT        NOT NULL UNIQUE,
  -- Primeiros 12 chars pra exibicao (ex: "pk_live_abc1"). Nao secret.
  key_prefix          TEXT        NOT NULL,
  created_by          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  last_used_at        TIMESTAMPTZ,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  -- Rate limiting: X requests por hora por chave
  rate_limit_per_hour INT         NOT NULL DEFAULT 200,
  -- Contador atomico gerenciado por consume_api_key_rate_limit()
  requests_this_hour  INT         NOT NULL DEFAULT 0,
  hour_start          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.api_keys IS 'Chaves de API para Lead Capture API. key_hash = SHA-256 da chave completa (pk_live_...).';
COMMENT ON COLUMN public.api_keys.key_prefix IS 'Primeiros 12 chars da chave original (ex: pk_live_abc1). Nao secret — usado para identificar a chave na UI sem expor o valor completo.';
COMMENT ON COLUMN public.api_keys.key_hash IS 'SHA-256 hex da chave completa. Usado para lookup por hash — nunca armazenamos a chave em claro.';

-- ------------------------------------------------------------
-- 2. capture_sources
-- ------------------------------------------------------------
CREATE TABLE public.capture_sources (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL, -- "Site principal", "LP Black Friday"
  api_key_id          UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  -- Roteamento opcional: se definido, lead vai direto pra esse funil/etapa
  pipeline_id         UUID        REFERENCES public.pipelines(id) ON DELETE SET NULL,
  stage_id            UUID        REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  -- Tags aplicadas automaticamente em leads desta fonte
  tag_ids             UUID[]      NOT NULL DEFAULT '{}',
  -- Janela de deduplicacao por telefone (0 = desativado)
  dedup_window_hours  INT         NOT NULL DEFAULT 24,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  public.capture_sources IS 'Origens de captura de leads. Cada fonte tem seu snippet embed e configuracao de roteamento independentes.';
COMMENT ON COLUMN public.capture_sources.dedup_window_hours IS 'Janela de deduplicacao por telefone em horas. 0 desativa dedup (todo submit cria lead novo).';
COMMENT ON COLUMN public.capture_sources.tag_ids IS 'IDs de tags aplicadas automaticamente em todo lead capturado por esta fonte.';

-- ------------------------------------------------------------
-- 3. inbound_requests — log de idempotencia
-- ------------------------------------------------------------
CREATE TABLE public.inbound_requests (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key   TEXT        NOT NULL,
  lead_id           UUID        REFERENCES public.leads(id) ON DELETE SET NULL,
  -- 'created' | 'deduplicated'
  status            TEXT        NOT NULL DEFAULT 'created',
  -- Body da resposta original serializado — retornado em replay
  response_body     JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, idempotency_key)
);

COMMENT ON TABLE public.inbound_requests IS 'Log de idempotencia da Lead Capture API. Evita criar leads duplicados em retries de rede.';

-- ------------------------------------------------------------
-- 4. Adicionar colunas UTM + capture_source_id em leads
-- ------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS capture_source_id UUID        REFERENCES public.capture_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS utm_source         TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium         TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign       TEXT,
  ADD COLUMN IF NOT EXISTS utm_term           TEXT,
  ADD COLUMN IF NOT EXISTS utm_content        TEXT;

COMMENT ON COLUMN public.leads.capture_source_id IS 'Origem de captura (capture_sources.id). NULL = lead de outro canal (WhatsApp, importacao, manual).';
COMMENT ON COLUMN public.leads.utm_source   IS 'UTM source capturado no momento do submit do formulario.';
COMMENT ON COLUMN public.leads.utm_medium   IS 'UTM medium capturado no momento do submit do formulario.';
COMMENT ON COLUMN public.leads.utm_campaign IS 'UTM campaign capturado no momento do submit do formulario.';
COMMENT ON COLUMN public.leads.utm_term     IS 'UTM term capturado no momento do submit do formulario.';
COMMENT ON COLUMN public.leads.utm_content  IS 'UTM content capturado no momento do submit do formulario.';

-- ------------------------------------------------------------
-- 5. Indexes
-- ------------------------------------------------------------
CREATE INDEX ON public.api_keys(organization_id) WHERE is_active = true;
CREATE INDEX ON public.capture_sources(organization_id);
CREATE INDEX ON public.capture_sources(api_key_id);
CREATE INDEX ON public.leads(capture_source_id) WHERE capture_source_id IS NOT NULL;
-- Para dedup por telefone + janela temporal na inbound route
CREATE INDEX ON public.leads(organization_id, phone, created_at) WHERE phone IS NOT NULL;
-- Para cleanup TTL de inbound_requests antigos (job futuro)
CREATE INDEX ON public.inbound_requests(created_at);

-- ------------------------------------------------------------
-- 6. Funcao: consume_api_key_rate_limit
-- ------------------------------------------------------------
-- Atomicamente:
--   a) valida que a chave existe e esta ativa
--   b) reseta o contador se a janela de 1h expirou
--   c) incrementa o contador
--   d) retorna se a requisicao e permitida + metadados
--
-- FOR UPDATE garante que 2 requests concorrentes nao corrompem o
-- contador (serialized increment). Sem isso, high-concurrency poderia
-- deixar passar mais requests do que o limite.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_api_key_rate_limit(p_key_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key       RECORD;
  v_new_count INT;
BEGIN
  SELECT id, organization_id, is_active, rate_limit_per_hour, requests_this_hour, hour_start
  INTO   v_key
  FROM   public.api_keys
  WHERE  key_hash = p_key_hash
  FOR    UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'key_not_found');
  END IF;

  IF NOT v_key.is_active THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'key_inactive');
  END IF;

  -- Resetar contador se a janela de 1h expirou
  IF v_key.hour_start < NOW() - INTERVAL '1 hour' THEN
    v_new_count := 1;
    UPDATE public.api_keys
    SET    requests_this_hour = 1,
           hour_start         = date_trunc('hour', NOW()),
           last_used_at       = NOW()
    WHERE  id = v_key.id;
  ELSE
    v_new_count := v_key.requests_this_hour + 1;
    UPDATE public.api_keys
    SET    requests_this_hour = v_new_count,
           last_used_at       = NOW()
    WHERE  id = v_key.id;
  END IF;

  RETURN jsonb_build_object(
    'allowed',              v_new_count <= v_key.rate_limit_per_hour,
    'key_id',               v_key.id,
    'organization_id',      v_key.organization_id,
    'requests_this_hour',   v_new_count,
    'rate_limit_per_hour',  v_key.rate_limit_per_hour
  );
END;
$$;

COMMENT ON FUNCTION public.consume_api_key_rate_limit(TEXT) IS
  'Atomicamente valida + incrementa rate limit de uma API key pelo hash SHA-256. Retorna JSONB com allowed, key_id, organization_id, requests_this_hour, rate_limit_per_hour.';

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------
ALTER TABLE public.api_keys        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capture_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_requests ENABLE ROW LEVEL SECURITY;

-- api_keys: membros ativos da org podem ver e gerenciar suas chaves
CREATE POLICY "org_members_api_keys"
  ON public.api_keys
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM   public.organization_members
      WHERE  user_id = auth.uid()
        AND  is_active = true
    )
  );

-- capture_sources: mesmo padrao
CREATE POLICY "org_members_capture_sources"
  ON public.capture_sources
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM   public.organization_members
      WHERE  user_id = auth.uid()
        AND  is_active = true
    )
  );

-- inbound_requests: apenas leitura pra auditoria — escrita via service_role na API
CREATE POLICY "org_members_inbound_requests_select"
  ON public.inbound_requests
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM   public.organization_members
      WHERE  user_id = auth.uid()
        AND  is_active = true
    )
  );

COMMIT;
