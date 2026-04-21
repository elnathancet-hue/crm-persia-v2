import { getAssistant } from "@/actions/ai";
import { SplitterClient } from "./splitter-client";

export default async function SplitterPage() {
  const assistant = await getAssistant();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Picotador de Mensagens</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Divida respostas longas da IA em mensagens curtas e naturais no WhatsApp
        </p>
      </div>
      <SplitterClient initialAssistant={assistant as never} />
    </div>
  );
}
