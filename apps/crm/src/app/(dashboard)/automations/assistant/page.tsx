import { getAssistants } from "@/actions/ai";
import { AssistantListClient } from "./assistant-list-client";

export default async function AssistantPage() {
  const assistants = await getAssistants();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Assistentes IA</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Crie assistentes especializados para apoiar agentes no atendimento
        </p>
      </div>
      <AssistantListClient initialAssistants={assistants as never} />
    </div>
  );
}
