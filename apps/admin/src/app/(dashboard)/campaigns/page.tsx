import {
  getCrmCampaignDetails,
  getWhatsAppConnectionStatus,
  listCampaignGroups,
  listCrmCampaigns,
} from "@/actions/crm-campaigns";
import { getPipelines, getAllStagesForOrg } from "@/actions/pipelines";
import { getSegments } from "@/actions/segments";
import { getTags } from "@/actions/tags";
import { CrmCampaignList } from "@/components/campaigns/crm-campaign-list";

export const metadata = { title: "Campanha" };

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = await searchParams;
  const editId = typeof resolvedSearchParams.edit === "string" ? resolvedSearchParams.edit : undefined;

  const [campaigns, segments, tagsResult, pipelines, stages, groups, editData, whatsappStatus] =
    await Promise.all([
      listCrmCampaigns().catch(() => []),
      getSegments().catch(() => []),
      getTags().catch(() => []),
      getPipelines().catch(() => []),
      getAllStagesForOrg().catch(() => []),
      listCampaignGroups().catch(() => []),
      editId ? getCrmCampaignDetails(editId).catch(() => null) : Promise.resolve(null),
      getWhatsAppConnectionStatus().catch(() => ({ connected: false, provider: null, phone: null })),
    ]);

  const segmentItems = (segments ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));
  const tagItems = (tagsResult ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));
  const pipelineItems = (pipelines ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }));
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
        whatsappStatus={whatsappStatus}
        initialEditData={editData}
      />
    </div>
  );
}
