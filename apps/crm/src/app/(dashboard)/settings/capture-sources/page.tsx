import { listCaptureSources } from "@/actions/capture-sources";
import { listApiKeys } from "@/actions/api-keys";
import { getPipelines, getAllStagesForOrg } from "@/actions/crm";
import { getTags } from "@/actions/tags";
import { CaptureSourcesClient } from "./capture-sources-client";

export const metadata = {
  title: "Origens de Captura — Configurações",
};

export default async function CaptureSourcesPage() {
  const [sources, apiKeys, pipelines, stages, tags] = await Promise.all([
    listCaptureSources(),
    listApiKeys(),
    getPipelines(),
    getAllStagesForOrg(),
    getTags(),
  ]);

  return (
    <CaptureSourcesClient
      initialSources={sources}
      apiKeys={apiKeys.filter((k) => k.is_active)}
      pipelines={pipelines as Array<{ id: string; name: string }>}
      allStages={stages as Array<{ id: string; pipeline_id: string; name: string }>}
      tags={tags as Array<{ id: string; name: string; color: string }>}
    />
  );
}
