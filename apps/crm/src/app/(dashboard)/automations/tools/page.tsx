import { getTools } from "@/actions/tools";
import { ToolsClient } from "./tools-client";

export const metadata = { title: "Biblioteca de mídia" };

export default async function ToolsPage() {
  const tools = await getTools();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Biblioteca de mídia</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Banco de imagens, PDFs, vídeos e documentos que o agente pode enviar durante a conversa.
        </p>
      </div>
      <ToolsClient initialTools={tools as never} />
    </div>
  );
}
