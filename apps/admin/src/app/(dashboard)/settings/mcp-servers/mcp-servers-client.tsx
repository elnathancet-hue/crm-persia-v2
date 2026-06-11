"use client";

import { useState, useTransition } from "react";
import { Code2, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { deleteMcpServer, toggleMcpServer } from "@/actions/settings";
import { useRouter } from "next/navigation";

type McpServer = {
  id: string;
  name: string | null;
  server_url: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

export function McpServersClient({ initialServers }: { initialServers: McpServer[] }) {
  const [servers, setServers] = useState(initialServers);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleToggle = (serverId: string, currentActive: boolean | null) => {
    startTransition(async () => {
      const result = await toggleMcpServer(serverId, !currentActive);
      if (!result.error) {
        setServers((prev) =>
          prev.map((s) => (s.id === serverId ? { ...s, is_active: !currentActive } : s)),
        );
        router.refresh();
      }
    });
  };

  const handleDelete = (serverId: string) => {
    if (!confirm("Remover este servidor MCP?")) return;
    startTransition(async () => {
      const result = await deleteMcpServer(serverId);
      if (!result.error) {
        setServers((prev) => prev.filter((s) => s.id !== serverId));
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-foreground">Servidores MCP</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Ferramentas personalizadas conectadas ao agente IA do cliente.
        </p>
      </div>

      <div className="border border-border rounded-xl bg-card overflow-hidden">
        {servers.map((server, i) => (
          <div
            key={server.id}
            className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? "border-t border-border/50" : ""}`}
          >
            <div className="size-8 rounded-lg flex items-center justify-center bg-muted shrink-0">
              <Code2 className="size-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {server.name || "Sem nome"}
              </p>
              <p className="text-xs text-muted-foreground font-mono truncate">
                {server.server_url || "—"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleToggle(server.id, server.is_active)}
                disabled={isPending}
                className="flex items-center gap-1 text-xs transition-colors disabled:opacity-50"
              >
                {server.is_active ? (
                  <span className="text-success flex items-center gap-1">
                    <CheckCircle2 className="size-3.5" /> Ativo
                  </span>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <XCircle className="size-3.5" /> Inativo
                  </span>
                )}
              </button>
              <button
                onClick={() => handleDelete(server.id)}
                disabled={isPending}
                className="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
