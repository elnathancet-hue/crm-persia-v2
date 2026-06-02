-- 088: crm_campaigns — módulo de campanhas WhatsApp robusto
-- Tabelas com prefixo crm_ para não colidir com a tabela legada `campaigns`.
-- Modelo: crm_campaigns → crm_campaign_steps + crm_campaign_targets
--         → crm_campaign_recipients → crm_campaign_message_jobs
--         → crm_campaign_events (auditoria)

-- ─── crm_campaigns ────────────────────────────────────────────────────────────

CREATE TABLE public.crm_campaigns (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL,
  description           TEXT,
  kind                  TEXT        NOT NULL CHECK (kind IN ('lead_campaign', 'group_campaign')),
  mode                  TEXT        NOT NULL CHECK (mode IN ('single', 'sequence', 'recurring')),
  status                TEXT        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft', 'validating', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  timezone              TEXT        NOT NULL DEFAULT 'America/Sao_Paulo',
  send_window_start     TIME,
  send_window_end       TIME,
  rate_limit_per_minute INT         CHECK (rate_limit_per_minute IS NULL OR rate_limit_per_minute > 0),
  stop_on_reply         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_campaigns_org_status
  ON public.crm_campaigns(organization_id, status);

CREATE INDEX idx_crm_campaigns_org_created
  ON public.crm_campaigns(organization_id, created_at DESC);

ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_campaigns_org_members"
  ON public.crm_campaigns FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ─── crm_campaign_steps ───────────────────────────────────────────────────────

CREATE TABLE public.crm_campaign_steps (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id      UUID        NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  position         INT         NOT NULL,
  send_mode        TEXT        NOT NULL CHECK (send_mode IN ('immediate', 'scheduled_at', 'delay_after_previous')),
  scheduled_at     TIMESTAMPTZ,
  delay_amount     INT,
  delay_unit       TEXT        CHECK (delay_unit IS NULL OR delay_unit IN ('minutes', 'hours', 'days')),
  message_text     TEXT,
  media_type       TEXT        NOT NULL DEFAULT 'none'
                               CHECK (media_type IN ('none', 'image', 'video', 'audio', 'document')),
  media_url        TEXT,
  media_filename   TEXT,
  media_mime_type  TEXT,
  media_size       INT,
  caption          TEXT,
  stop_if_replied  BOOLEAN,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (campaign_id, position),

  -- Scheduled mode requires scheduled_at
  CONSTRAINT step_scheduled_at_required
    CHECK (send_mode != 'scheduled_at' OR scheduled_at IS NOT NULL),

  -- Delay mode requires delay_amount and delay_unit
  CONSTRAINT step_delay_required
    CHECK (send_mode != 'delay_after_previous' OR (delay_amount IS NOT NULL AND delay_unit IS NOT NULL)),

  -- Media url required when media_type != none
  CONSTRAINT step_media_url_required
    CHECK (media_type = 'none' OR media_url IS NOT NULL),

  -- At least message_text or media_url must exist
  CONSTRAINT step_content_required
    CHECK (message_text IS NOT NULL OR media_url IS NOT NULL)
);

CREATE INDEX idx_crm_campaign_steps_campaign
  ON public.crm_campaign_steps(campaign_id, position);

ALTER TABLE public.crm_campaign_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_campaign_steps_org_members"
  ON public.crm_campaign_steps FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ─── crm_campaign_targets ─────────────────────────────────────────────────────

CREATE TABLE public.crm_campaign_targets (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id     UUID        NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  target_kind     TEXT        NOT NULL
                              CHECK (target_kind IN ('segment', 'tag', 'funnel_stage', 'lead', 'group', 'manual')),
  target_id       UUID,
  filters         JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- target_id required for non-manual kinds
  CONSTRAINT target_id_required
    CHECK (target_kind = 'manual' OR target_id IS NOT NULL)
);

CREATE INDEX idx_crm_campaign_targets_campaign
  ON public.crm_campaign_targets(campaign_id);

ALTER TABLE public.crm_campaign_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_campaign_targets_org_members"
  ON public.crm_campaign_targets FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ─── crm_campaign_recipients ──────────────────────────────────────────────────

CREATE TABLE public.crm_campaign_recipients (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id       UUID        NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  recipient_type    TEXT        NOT NULL CHECK (recipient_type IN ('lead', 'group')),
  lead_id           UUID        REFERENCES public.leads(id) ON DELETE SET NULL,
  group_id          UUID        REFERENCES public.whatsapp_groups(id) ON DELETE SET NULL,
  conversation_id   UUID        REFERENCES public.conversations(id) ON DELETE SET NULL,
  phone             TEXT,
  chat_jid          TEXT,
  display_name      TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'active', 'completed', 'stopped', 'failed', 'ineligible')),
  ineligible_reason TEXT,
  last_response_at  TIMESTAMPTZ,
  resolved_from     JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- lead_id required for lead recipients
  CONSTRAINT recipient_lead_id_required
    CHECK (recipient_type != 'lead' OR lead_id IS NOT NULL),

  -- group_id required for group recipients
  CONSTRAINT recipient_group_id_required
    CHECK (recipient_type != 'group' OR group_id IS NOT NULL)
);

-- Unique: one active lead per campaign
CREATE UNIQUE INDEX idx_crm_campaign_recipients_lead_unique
  ON public.crm_campaign_recipients(campaign_id, lead_id)
  WHERE lead_id IS NOT NULL;

-- Unique: one active group per campaign
CREATE UNIQUE INDEX idx_crm_campaign_recipients_group_unique
  ON public.crm_campaign_recipients(campaign_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX idx_crm_campaign_recipients_campaign
  ON public.crm_campaign_recipients(campaign_id, status);

ALTER TABLE public.crm_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_campaign_recipients_org_members"
  ON public.crm_campaign_recipients FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ─── crm_campaign_message_jobs ────────────────────────────────────────────────

CREATE TABLE public.crm_campaign_message_jobs (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id         UUID        NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  step_id             UUID        NOT NULL REFERENCES public.crm_campaign_steps(id) ON DELETE CASCADE,
  recipient_id        UUID        NOT NULL REFERENCES public.crm_campaign_recipients(id) ON DELETE CASCADE,
  send_at             TIMESTAMPTZ NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'queued'
                                  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  attempts            INT         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error          TEXT,
  provider_message_id TEXT,
  sent_at             TIMESTAMPTZ,
  locked_at           TIMESTAMPTZ,
  locked_by           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (campaign_id, step_id, recipient_id)
);

CREATE INDEX idx_crm_campaign_jobs_status_send_at
  ON public.crm_campaign_message_jobs(status, send_at)
  WHERE status IN ('queued', 'sending');

CREATE INDEX idx_crm_campaign_jobs_org_status
  ON public.crm_campaign_message_jobs(organization_id, status, send_at);

CREATE INDEX idx_crm_campaign_jobs_campaign_recipient
  ON public.crm_campaign_message_jobs(campaign_id, recipient_id);

ALTER TABLE public.crm_campaign_message_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_campaign_jobs_org_members"
  ON public.crm_campaign_message_jobs FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ─── crm_campaign_events ──────────────────────────────────────────────────────

CREATE TABLE public.crm_campaign_events (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id     UUID        NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  recipient_id    UUID        REFERENCES public.crm_campaign_recipients(id) ON DELETE SET NULL,
  job_id          UUID        REFERENCES public.crm_campaign_message_jobs(id) ON DELETE SET NULL,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_campaign_events_campaign
  ON public.crm_campaign_events(campaign_id, created_at DESC);

CREATE INDEX idx_crm_campaign_events_recipient
  ON public.crm_campaign_events(recipient_id)
  WHERE recipient_id IS NOT NULL;

-- Events are append-only: no UPDATE/DELETE for org members.
ALTER TABLE public.crm_campaign_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_campaign_events_select"
  ON public.crm_campaign_events FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

CREATE POLICY "crm_campaign_events_insert"
  ON public.crm_campaign_events FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ─── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Only add triggers if the function/tables are fresh (idempotent-safe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_campaigns_updated_at'
  ) THEN
    CREATE TRIGGER trg_crm_campaigns_updated_at
      BEFORE UPDATE ON public.crm_campaigns
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_campaign_jobs_updated_at'
  ) THEN
    CREATE TRIGGER trg_crm_campaign_jobs_updated_at
      BEFORE UPDATE ON public.crm_campaign_message_jobs
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END;
$$;
