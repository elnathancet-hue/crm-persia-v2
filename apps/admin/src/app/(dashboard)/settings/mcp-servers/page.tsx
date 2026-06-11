import { requireSuperadminForOrg } from "@/lib/auth";
import { readAdminContext } from "@/lib/admin-context";
import { NoContextFallback } from "@/components/no-context-fallback";
import { listMcpServersAdmin } from "@/actions/settings";
import { notFound } from "next/navigation";
import { Code2 } from "lucide-react";
import { McpServersClient } from "./mcp-servers-client";

export const metadata = { title: "Servidores MCP — Configurações" };

export default async function McpServersPage() {
  const ctxCookie = await readAdminContext();
  if (!ctxCookie) return <NoContextFallback />;

  try {
    await requireSuperadminForOrg();
  } catch {
    notFound();
  }

  const servers = await listMcpServersAdmin();

  if (servers.length === 0) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div>
          <h2 className="text-base font-semibold text-foreground">Servidores MCP</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ferramentas personalizadas conectadas ao agente IA do cliente.
          </p>
        </div>
        <div className="border border-border rounded-xl bg-card p-8 text-center">
          <Code2 className="size-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum servidor MCP configurado.</p>
        </div>
      </div>
    );
  }

  return <McpServersClient initialServers={servers} />;
}
