-- migration: 077_atomic_stage_reorder_and_pipeline_delete
-- contexto: updateStageOrder e deletePipeline faziam N operacoes
-- sequenciais sem transacao. Se timeout no meio, dados ficavam
-- inconsistentes. Estas RPCs garantem atomicidade.

-- ============================================================
-- 1. reorder_stages — atualiza sort_order de N stages atomicamente
-- ============================================================

CREATE OR REPLACE FUNCTION public.reorder_stages(
  p_org_id uuid,
  p_stages jsonb  -- array de { "id": uuid, "position": int }
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  v_id uuid;
  v_pos int;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_stages)
  LOOP
    v_id  := (item ->> 'id')::uuid;
    v_pos := (item ->> 'position')::int;

    UPDATE pipeline_stages
    SET sort_order = v_pos
    WHERE id = v_id
      AND organization_id = p_org_id;
  END LOOP;
END;
$$;

-- ============================================================
-- 2. delete_pipeline_cascade — deleta pipeline + stages + deals
--    em uma unica transacao. Org-scoped.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_pipeline_cascade(
  p_org_id uuid,
  p_pipeline_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  -- Valida ownership
  SELECT EXISTS(
    SELECT 1 FROM pipelines
    WHERE id = p_pipeline_id AND organization_id = p_org_id
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Pipeline nao encontrado nesta organizacao';
  END IF;

  -- Deleta deals das stages do pipeline
  DELETE FROM deals
  WHERE stage_id IN (
    SELECT id FROM pipeline_stages
    WHERE pipeline_id = p_pipeline_id AND organization_id = p_org_id
  )
  AND organization_id = p_org_id;

  -- Deleta stages
  DELETE FROM pipeline_stages
  WHERE pipeline_id = p_pipeline_id
    AND organization_id = p_org_id;

  -- Deleta pipeline
  DELETE FROM pipelines
  WHERE id = p_pipeline_id
    AND organization_id = p_org_id;
END;
$$;
