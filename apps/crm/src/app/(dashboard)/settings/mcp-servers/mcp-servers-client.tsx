"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  Plus,
  Plug,
  RefreshCw,
  ServerCrash,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { RelativeTime } from "@persia/ui";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { DialogHero } from "@persia/ui/dialog-hero";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
import {
  createMcpServer,
  deleteMcpServer,
  syncMcpServer,
  type McpServerRow,
} from "@/actions/mcp-servers";

interface Props {
  initialServers: McpServerRow[];
  initialError: string | null;
}

export function McpServersClient({ initialServers, initialError }: Props) {
  const router = useRouter();
  const [servers, setServers] = React.useState(initialServers);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    router.refresh();
  }, [router]);

  async function handleCreate(form: {
    name: string;
    server_url: string;
    auth_type: "none" | "bearer";
    auth_token: string;
  }) {
    setPending("create");
    try {
      const res = await createMcpServer({
        name: form.name,
        server_url: form.server_url,
        auth_type: form.auth_type,
        auth_token: form.auth_type === "bearer" ? form.auth_token : undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Servidor adicionado. Clique Sincronizar pra carregar as tools.");
      setSheetOpen(false);
      refresh();
    } finally {
      setPending(null);
    }
  }

  async function handleSync(serverId: string) {
    setPending(`sync:${serverId}`);
    try {
      const res = await syncMcpServer(serverId);
      if (!res.ok) {
        toast.error(res.error || "Falha na sincronização.");
        return;
      }
      toast.success(`${res.tools_count} tools descobertas.`);
      refresh();
    } finally {
      setPending(null);
    }
  }

  async function handleDelete(serverId: string, name: string) {
    if (!confirm(`Remover servidor "${name}"? Tools dele paradas de funcionar.`)) {
      return;
    }
    setPending(`delete:${serverId}`);
    try {
      const res = await deleteMcpServer(serverId);
      if (!res.ok) {
        toast.error(res.error || "Falha ao remover.");
        return;
      }
      setServers((s) => s.filter((sv) => sv.id !== serverId));
      toast.success("Servidor removido.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Plug className="size-5" />
            Servidores MCP
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte servidores MCP (Model Context Protocol) externos pra
            estender a IA com tools customizadas — APIs próprias, ERPs,
            integrações de terceiros. Cada server discoverá suas tools
            via JSON-RPC.
          </p>
        </div>
        <Button onClick={() => setSheetOpen(true)} disabled={pending !== null}>
          <Plus className="size-4" />
          Adicionar servidor
        </Button>
      </div>

      {initialError && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {initialError}
          </CardContent>
        </Card>
      )}

      {servers.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum servidor MCP conectado. Clique em &quot;Adicionar
            servidor&quot; pra começar.
          </CardContent>
        </Card>
      ) : (
        servers.map((server) => (
          <Card key={server.id}>
            <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ServerCrash className="size-4" />
                  {server.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground font-mono mt-1">
                  {server.server_url}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Auth: {server.auth_type === "bearer" ? "Bearer token" : "Sem auth"}
                  {server.has_auth_token && server.auth_type === "bearer" && (
                    <span className="ml-1 opacity-70">(token salvo)</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={server.last_sync_error ? "destructive" : "outline"}
                  className="gap-1"
                >
                  {server.last_sync_error ? (
                    <XCircle className="size-3" />
                  ) : (
                    <CheckCircle2 className="size-3" />
                  )}
                  {server.cached_tools.length} tools
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {server.last_sync_error && (
                <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  Última sincronização falhou: {server.last_sync_error}
                </div>
              )}
              {server.cached_tools.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Ver {server.cached_tools.length} tools descobertas
                  </summary>
                  <ul className="mt-2 space-y-1 pl-4">
                    {server.cached_tools.map((t) => (
                      <li key={t.name} className="flex items-baseline gap-2">
                        <Wrench className="size-3 inline opacity-60" />
                        <code className="font-mono">{t.name}</code>
                        {t.description && (
                          <span className="text-muted-foreground">
                            — {t.description.slice(0, 80)}
                            {t.description.length > 80 ? "..." : ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {server.last_synced_at && (
                <p className="text-xs text-muted-foreground">
                  Última sincronização:{" "}
                  <RelativeTime iso={server.last_synced_at} formatter={(d) => d.toLocaleString("pt-BR")} />
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSync(server.id)}
                  disabled={pending === `sync:${server.id}`}
                >
                  {pending === `sync:${server.id}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Sincronizar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(server.id, server.name)}
                  disabled={pending === `delete:${server.id}`}
                  className="text-destructive hover:text-destructive"
                >
                  {pending === `delete:${server.id}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  Remover
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <AddServerSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSubmit={handleCreate}
        pending={pending === "create"}
      />
    </div>
  );
}

// ============================================================================
// Sub-component: add server sheet
// ============================================================================

function AddServerSheet({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (form: {
    name: string;
    server_url: string;
    auth_type: "none" | "bearer";
    auth_token: string;
  }) => void | Promise<void>;
  pending: boolean;
}) {
  const [name, setName] = React.useState("");
  const [serverUrl, setServerUrl] = React.useState("");
  const [authType, setAuthType] = React.useState<"none" | "bearer">("none");
  const [authToken, setAuthToken] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setName("");
      setServerUrl("");
      setAuthType("none");
      setAuthToken("");
    }
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[480px] flex flex-col p-0">
        <SheetHeader className="border-b border-border bg-card p-5">
          <SheetTitle className="sr-only">Adicionar servidor MCP</SheetTitle>
          <DialogHero
            icon={<Plug className="size-5" />}
            title="Adicionar servidor MCP"
            tagline="Conecte um servidor JSON-RPC para estender a IA com tools customizadas"
          />
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-name">Nome amigável</Label>
            <Input
              id="mcp-name"
              name="mcp_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Meu ERP, GitHub MCP, Notion API"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-url">URL do servidor MCP</Label>
            <Input
              id="mcp-url"
              name="mcp_url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://mcp.exemplo.com/rpc"
            />
            <p className="text-xs text-muted-foreground">
              Endpoint HTTP que recebe JSON-RPC 2.0 (tools/list, tools/call).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-auth">Autenticação</Label>
            <Select
              value={authType}
              onValueChange={(v) => v && setAuthType(v as "none" | "bearer")}
            >
              <SelectTrigger id="mcp-auth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem autenticação</SelectItem>
                <SelectItem value="bearer">Bearer token (header Authorization)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType === "bearer" && (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-token">Token</Label>
              <Input
                id="mcp-token"
                name="mcp_auth_token"
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="sk-..."
              />
            </div>
          )}
        </div>
        <div className="border-t border-border p-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={() => onSubmit({ name, server_url: serverUrl, auth_type: authType, auth_token: authToken })}
            disabled={
              pending ||
              !name.trim() ||
              !serverUrl.trim() ||
              (authType === "bearer" && !authToken.trim())
            }
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Adicionar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
