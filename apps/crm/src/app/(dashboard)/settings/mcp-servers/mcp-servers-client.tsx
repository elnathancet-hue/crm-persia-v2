"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  Plus,
  Plug,
  Power,
  PowerOff,
  RefreshCw,
  Server,
  Trash2,
  Wrench,
  XCircle,
  X,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
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
  toggleMcpServer,
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
  const [deleteConfirm, setDeleteConfirm] = React.useState<McpServerRow | null>(null);

  const refresh = React.useCallback(() => {
    router.refresh();
  }, [router]);

  async function handleCreate(form: {
    name: string;
    server_url: string;
    auth_type: "none" | "bearer" | "headers";
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

  async function handleToggle(server: McpServerRow) {
    setPending(`toggle:${server.id}`);
    try {
      const res = await toggleMcpServer(server.id, !server.is_active);
      if (!res.ok) { toast.error(res.error || "Falha ao alterar status."); return; }
      setServers((s) => s.map((sv) => sv.id === server.id ? { ...sv, is_active: !sv.is_active } : sv));
      toast.success(server.is_active ? "Servidor desativado." : "Servidor ativado.");
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    const serverId = deleteConfirm.id;
    setPending(`delete:${serverId}`);
    try {
      const res = await deleteMcpServer(serverId);
      if (!res.ok) {
        toast.error(res.error || "Falha ao remover.");
        return;
      }
      setServers((s) => s.filter((sv) => sv.id !== serverId));
      setDeleteConfirm(null);
      toast.success("Servidor removido.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Conecte servidores MCP (Model Context Protocol) externos pra
          estender a IA com tools customizadas — APIs próprias, ERPs,
          integrações de terceiros. Cada server descobrirá suas tools via JSON-RPC.
        </p>
        <Button onClick={() => setSheetOpen(true)} disabled={pending !== null} className="shrink-0" size="sm">
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
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Plug className="size-8 text-muted-foreground/50" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Nenhum servidor conectado</p>
              <p className="text-xs text-muted-foreground">
                Adicione um servidor MCP para estender a IA com tools customizadas.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
              <Plus className="size-4" />
              Adicionar servidor
            </Button>
          </CardContent>
        </Card>
      ) : (
        servers.map((server) => (
          <Card key={server.id}>
            <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Server className="size-4" />
                  {server.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground font-mono mt-1">
                  {server.server_url}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Auth:{" "}
                  {server.auth_type === "bearer"
                    ? "Access token / API key"
                    : server.auth_type === "headers"
                      ? "Headers personalizados"
                      : "Nenhuma"}
                  {server.has_auth_token && server.auth_type !== "none" && (
                    <span className="ml-1 opacity-70">(salvo)</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={server.is_active ? "default" : "secondary"}>
                  {server.is_active ? "Ativo" : "Inativo"}
                </Badge>
                <Badge variant={server.last_sync_error ? "destructive" : "outline"}>
                  {server.last_sync_error ? (
                    <XCircle className="size-3 mr-1" />
                  ) : (
                    <CheckCircle2 className="size-3 mr-1" />
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
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggle(server)}
                  disabled={!!pending}
                >
                  {pending === `toggle:${server.id}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : server.is_active ? (
                    <PowerOff className="size-3.5" />
                  ) : (
                    <Power className="size-3.5" />
                  )}
                  {server.is_active ? "Desativar" : "Ativar"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteConfirm(server)}
                  disabled={pending === `delete:${server.id}`}
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

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-sm">
          <DialogHeader className="border-b border-border bg-card p-5">
            <DialogTitle className="sr-only">Remover servidor MCP</DialogTitle>
            <DialogHero
              icon={<Trash2 className="size-5" />}
              title="Remover servidor"
              tagline={`"${deleteConfirm?.name ?? ""}" será desconectado`}
              tone="destructive"
            />
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              As tools deste servidor deixarão de funcionar nos agentes de IA que as utilizam.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)} disabled={!!pending}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={!!pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Remover
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

type AuthType = "none" | "bearer" | "headers";

interface CustomHeader {
  key: string;
  value: string;
}

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
    auth_type: AuthType;
    auth_token: string;
  }) => void | Promise<void>;
  pending: boolean;
}) {
  const [name, setName] = React.useState("MCP");
  const [serverUrl, setServerUrl] = React.useState("");
  const [authType, setAuthType] = React.useState<AuthType>("bearer");
  const [authToken, setAuthToken] = React.useState("");
  const [customHeaders, setCustomHeaders] = React.useState<CustomHeader[]>([
    { key: "Authorization", value: "" },
  ]);

  React.useEffect(() => {
    if (!open) {
      setName("MCP");
      setServerUrl("");
      setAuthType("bearer");
      setAuthToken("");
      setCustomHeaders([{ key: "Authorization", value: "" }]);
    }
  }, [open]);

  function addHeader() {
    setCustomHeaders((h) => [...h, { key: "", value: "" }]);
  }

  function removeHeader(index: number) {
    setCustomHeaders((h) => h.filter((_, i) => i !== index));
  }

  function updateHeader(index: number, field: "key" | "value", val: string) {
    setCustomHeaders((h) =>
      h.map((row, i) => (i === index ? { ...row, [field]: val } : row)),
    );
  }

  function buildAuthToken(): string {
    if (authType === "bearer") return authToken;
    if (authType === "headers") {
      const obj: Record<string, string> = {};
      for (const { key, value } of customHeaders) {
        if (key.trim()) obj[key.trim()] = value;
      }
      return JSON.stringify(obj);
    }
    return "";
  }

  const isValid =
    name.trim() &&
    serverUrl.trim() &&
    (authType === "none" ||
      (authType === "bearer" && authToken.trim()) ||
      (authType === "headers" && customHeaders.some((h) => h.key.trim())));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[480px] flex flex-col p-0">
        <SheetHeader className="border-b border-border bg-card p-5">
          <SheetTitle className="sr-only">Adicionar servidor MCP</SheetTitle>
          <DialogHero
            icon={<Plug className="size-5" />}
            title="Configuração no MCP"
            tagline="Configure o servidor MCP que será utilizado para gerenciar as ferramentas"
          />
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-name">Nome do servidor</Label>
            <Input
              id="mcp-name"
              name="mcp_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MCP"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-url">URL do servidor</Label>
            <Input
              id="mcp-url"
              name="mcp_url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="URL do servidor"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-auth">Autenticação</Label>
            <Select
              value={authType}
              onValueChange={(v) => v && setAuthType(v as AuthType)}
            >
              <SelectTrigger id="mcp-auth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma</SelectItem>
                <SelectItem value="bearer">Access token / API key</SelectItem>
                <SelectItem value="headers">Headers personalizados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType === "bearer" && (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-token">Access token / API key</Label>
              <Input
                id="mcp-token"
                name="mcp_auth_token"
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="Cole o token ou API key"
              />
            </div>
          )}
          {authType === "headers" && (
            <div className="space-y-2">
              {customHeaders.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={row.key}
                    onChange={(e) => updateHeader(i, "key", e.target.value)}
                    placeholder="Header"
                    className="flex-1"
                  />
                  <Input
                    value={row.value}
                    onChange={(e) => updateHeader(i, "value", e.target.value)}
                    placeholder="Valor"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive hover:text-destructive"
                    onClick={() => removeHeader(i)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addHeader}
                className="gap-1.5"
              >
                <Plus className="size-3.5" />
                Adicionar Header
              </Button>
            </div>
          )}
        </div>
        <div className="border-t border-border p-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Voltar
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                name,
                server_url: serverUrl,
                auth_type: authType,
                auth_token: buildAuthToken(),
              })
            }
            disabled={pending || !isValid}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Continuar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
