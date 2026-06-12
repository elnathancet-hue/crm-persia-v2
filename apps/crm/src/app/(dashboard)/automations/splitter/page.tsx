import { getAssistant } from "@/actions/ai";
import { listAgents } from "@/actions/ai-agent/configs";
import { SplitterClient } from "./splitter-client";
import { LegacyBanner } from "@/components/legacy-banner";

export const metadata = { title: "Picotador de Mensagens" };

export default async function SplitterPage() {
  const [assistant, agents] = await Promise.all([
    getAssistant(),
    listAgents().catch(() => [] as Awaited<ReturnType<typeof listAgents>>),
  ]);
  const hasNativeAgent = agents.some((a) => a.status === "active");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Picotador de Mensagens</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Divida respostas longas da IA em mensagens curtas e naturais no WhatsApp
        </p>
      </div>
      <LegacyBanner featureName="Picotador de Mensagens" />
      <SplitterClient initialAssistant={assistant as never} hasNativeAgent={hasNativeAgent} />
    </div>
  );
}
