-- 080: group_memberships — correções de RLS, RPCs de capacidade e stats
--
-- Auditoria grupos+leads (mai/2026) identificou 3 problemas críticos:
--
-- P0: Faltavam políticas DELETE/UPDATE em group_memberships → removeLeadFromGroup
--     retornava { success: true } mas nunca deletava nada (Supabase RLS filtra
--     silenciosamente sem política = 0 rows affected, sem erro).
--
-- P1: Função increment_group_participant_count não existia → .catch(() => {}) em
--     recordGroupJoin engolia o erro silenciosamente → participant_count nunca
--     subia via smart link → resolveSmartLink nunca detectava grupo cheio.
--
-- P2: getLeadGroups fazia N queries para stats de mensagens (loop por grupo).
--     Novo RPC get_group_message_stats resolve em 1 query com UNNEST.

-- ─── 1. RLS: DELETE + UPDATE em group_memberships ─────────────────────────────

CREATE POLICY "group_memberships_delete"
  ON public.group_memberships FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

CREATE POLICY "group_memberships_update"
  ON public.group_memberships FOR UPDATE
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

-- ─── 2. Incrementa participant_count ──────────────────────────────────────────
-- Chamado em recordGroupJoin (smart link) após membership ser criada.
-- SECURITY DEFINER: pode ser chamado pelo service_role via supabase-js .rpc().

CREATE OR REPLACE FUNCTION public.increment_group_participant_count(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_groups
  SET participant_count = participant_count + 1,
      updated_at        = NOW()
  WHERE id = p_group_id;
END;
$$;

-- ─── 3. Decrementa participant_count ──────────────────────────────────────────
-- Chamado em removeLeadFromGroup após deletar membership do DB.
-- GREATEST(0, ...) evita valores negativos por inconsistência de sync.

CREATE OR REPLACE FUNCTION public.decrement_group_participant_count(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_groups
  SET participant_count = GREATEST(0, participant_count - 1),
      updated_at        = NOW()
  WHERE id = p_group_id;
END;
$$;

-- ─── 4. Stats de mensagens por grupo (resolve N+1 em getLeadGroups) ───────────
-- Recebe dois arrays paralelos: group_ids + joined_ats.
-- Conta só mensagens inbound a partir da data de entrada do lead em cada grupo.
-- Retorna: group_id, message_count, last_message (texto), last_message_at.

CREATE OR REPLACE FUNCTION public.get_group_message_stats(
  p_org_id     UUID,
  p_group_ids  UUID[],
  p_joined_ats TIMESTAMPTZ[]
)
RETURNS TABLE (
  group_id       UUID,
  message_count  BIGINT,
  last_message   TEXT,
  last_message_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    gm.group_id,
    COUNT(*)                                                   AS message_count,
    (ARRAY_AGG(gm.text ORDER BY gm.created_at DESC))[1]        AS last_message,
    MAX(gm.created_at)                                         AS last_message_at
  FROM public.group_messages gm
  JOIN UNNEST(p_group_ids, p_joined_ats) AS t(gid, joined_at)
    ON gm.group_id = t.gid
   AND gm.created_at >= t.joined_at
  WHERE gm.organization_id = p_org_id
    AND gm.direction = 'inbound'
  GROUP BY gm.group_id;
$$;
