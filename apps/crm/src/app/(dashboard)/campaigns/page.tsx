import { PageTitle } from "@persia/ui/typography";
import { requireAdminPageAccess } from "@/lib/guards/require-admin";
import {
  listCampaignGroups, listCrmCampaigns,
  getCampaignJobProgress, getWhatsAppConnectionStatus,
} from "@/actions/crm-campaigns";
import { getSegments } from "@/actions/segments";
import { getTags } from "@/actions/tags";
import { getPipelines, getAllStagesForOrg } from "@/actions/crm";
import { CrmCampaignList } from "@/components/campaigns/crm-campaign-list";

export default async function CampaignsPage() {
  await requireAdminPageAccess();

  const [campaigns, segments, tagsResult, pipelines, stages, groups] = await Promise.all([
    listCrmCampaigns().catch(() => []),
    getSegments().catch(() => []),
    getTags().catch(() => []),
    getPipelines().catch(() => []),
    getAllStagesForOrg().catch(() => []),
    listCampaignGroups().catch(() => []),
  ]);

  const campaignIds = campaigns.map((c) => c.id);
  const [jobProgress, whatsappStatus] = await Promise.all([
    getCampaignJobProgress(campaignIds).catch(() => []),
    getWhatsAppConnectionStatus().catch(() => ({ connected: false, provider: null, phone: null })),
  ]);

  const segmentItems = (segments ?? []).map((s) => ({ id: s.id, name: s.name }));
  const tagItems = (tagsResult ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));
  const pipelineItems = (pipelines ?? []).map((p) => ({ id: p.id, name: p.name }));
  const stageItems = (stages ?? []).map((s: { id: string; pipeline_id: string; name: string }) => ({
    id: s.id,
    pipeline_id: s.pipeline_id,
    name: s.name,
  }));

  return (
    <div className="space-y-6">
      <CrmCampaignList
        campaigns={campaigns}
        segments={segmentItems}
        tags={tagItems}
        pipelines={pipelineItems}
        stages={stageItems}
        groups={groups}
        jobProgress={jobProgress}
        whatsappStatus={whatsappStatus}
      />
    </div>
  );
}
