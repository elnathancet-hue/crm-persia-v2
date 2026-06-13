-- RPCs para negacao em match-leads sem carregar todos os leads em memoria.
--
-- match_leads_not_tagged: leads do org que NAO possuem nenhuma das tags.
-- match_leads_without_open_deal: leads do org que NAO possuem deal aberto.
--
-- Eliminam o padrao "buscar todos os leads e filtrar em JS" dos resolvers
-- not_contains e deal_status is_null em match-leads.ts.

CREATE OR REPLACE FUNCTION match_leads_not_tagged(
  p_org_id  uuid,
  p_tag_ids uuid[]
)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id
  FROM leads l
  WHERE l.organization_id = p_org_id
    AND NOT EXISTS (
      SELECT 1
      FROM lead_tags lt
      WHERE lt.lead_id = l.id
        AND lt.tag_id = ANY(p_tag_ids)
        AND lt.organization_id = p_org_id
    );
$$;

CREATE OR REPLACE FUNCTION match_leads_without_open_deal(p_org_id uuid)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id
  FROM leads l
  WHERE l.organization_id = p_org_id
    AND NOT EXISTS (
      SELECT 1
      FROM deals d
      WHERE d.lead_id = l.id
        AND d.organization_id = p_org_id
        AND d.status = 'open'
    );
$$;
