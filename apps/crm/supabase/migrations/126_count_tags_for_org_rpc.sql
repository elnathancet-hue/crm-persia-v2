-- RPC: count_tags_for_org
-- Retorna (tag_id, lead_count) para todas as tags de um org via GROUP BY no banco.
-- Substitui o loop paginado em JS que transferia todas as rows de lead_tags.

CREATE OR REPLACE FUNCTION count_tags_for_org(p_org_id uuid)
RETURNS TABLE(tag_id uuid, lead_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lt.tag_id, COUNT(*)::bigint AS lead_count
  FROM lead_tags lt
  WHERE lt.organization_id = p_org_id
  GROUP BY lt.tag_id;
$$;
