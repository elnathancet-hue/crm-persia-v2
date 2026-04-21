-- Backfill records created by older Admin flows that did not persist
-- organization_id consistently. CRM screens filter by organization_id, so these
-- rows must carry the same org as their parent pipeline/lead.

update public.pipeline_stages ps
set organization_id = p.organization_id
from public.pipelines p
where ps.pipeline_id = p.id
  and (
    ps.organization_id is null
    or ps.organization_id <> p.organization_id
  );

update public.lead_tags lt
set organization_id = l.organization_id
from public.leads l
where lt.lead_id = l.id
  and (
    lt.organization_id is null
    or lt.organization_id <> l.organization_id
  );

create index if not exists idx_pipeline_stages_org_pipeline_sort
  on public.pipeline_stages (organization_id, pipeline_id, sort_order);

create index if not exists idx_lead_tags_org_tag_lead
  on public.lead_tags (organization_id, tag_id, lead_id);
