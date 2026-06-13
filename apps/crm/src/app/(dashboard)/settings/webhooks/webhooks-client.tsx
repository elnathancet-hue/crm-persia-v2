"use client";

import * as React from "react";
import {
  Plus,
  Trash2,
  Webhook,
  ArrowDownToLine,
  ArrowUpFromLine,
  Power,
  PowerOff,
  Copy,
  Loader2,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { DialogHero } from "@persia/ui/dialog-hero";
import { Badge } from "@persia/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@persia/ui/table";
import { Card, CardContent } from "@persia/ui/card";
import {
  createWebhook,
  deleteWebhook,
  toggleWebhookActive,
} from "@/actions/webhooks";
import { toast } from "sonner";

interface WebhookItem {
  id: string;
  name: string;
  direction: string;
  url: string | null;
  token: string | null;
  events: string[];
  is_active: boolean;
  created_at: string;
}

export function WebhooksPageClient({
  initialWebhooks,
}: {
  initialWebhooks: WebhookItem[];
}) {
  const [webhooks, setWebhooks] =
    React.useState<WebhookItem[]>(initialWebhooks);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState<WebhookItem | null>(null);

  const [name, setName] = React.useState("");
  const [direction, setDirection] = React.useState("outbound");
  const [url, setUrl] = React.useState("");
  const [events, setEvents] = React.useState("");

  function openCreateDialog() {
    setName("");
    setDirection("outbound");
    setUrl("");
    setEvents("");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    if (direction === "outbound" && !url.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("direction", direction);
      fd.set("url", url.trim());
      fd.set("events", events);
      const newWebhook = await createWebhook(fd);
      if (newWebhook) {
        setWebhooks((prev) => [newWebhook as WebhookItem, ...prev]);
      }
      setCreateOpen(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar webhook");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(webhook: WebhookItem) {
    setSaving(true);
    try {
      await toggleWebhookActive(webhook.id, !webhook.is_active);
      setWebhooks((prev) =>
        prev.map((w) =>
          w.id === webhook.id ? { ...w, is_active: !w.is_active } : w
        )
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar webhook");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const id = deleteConfirm.id;
    setDeleteConfirm(null);
    setSaving(true);
    try {
      await deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir webhook");
    } finally {
      setSaving(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreateDialog}>
          <Plus className="size-4" />
          Novo Webhook
        </Button>
      </div>

      {webhooks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Webhook className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhum webhook configurado</p>
            <p className="text-sm text-muted-foreground">
              Configure webhooks para integrar com outros sistemas
            </p>
            <Button className="mt-4" onClick={openCreateDialog}>
              <Plus className="size-4" />
              Criar primeiro webhook
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Direção</TableHead>
              <TableHead>URL / Token</TableHead>
              <TableHead>Eventos</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.map((webhook) => (
              <TableRow key={webhook.id}>
                <TableCell className="font-medium">{webhook.name}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {webhook.direction === "inbound" ? (
                      <ArrowDownToLine className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpFromLine className="size-3.5 text-success" />
                    )}
                    <span className="text-sm">
                      {webhook.direction === "inbound" ? "Entrada" : "Saída"}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {webhook.direction === "inbound" ? (
                    <div className="flex items-center gap-1">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[160px] truncate block">
                        {webhook.token || "-"}
                      </code>
                      {webhook.token && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label="Copiar token"
                          onClick={() => copyToClipboard(webhook.token!)}
                        >
                          <Copy className="size-3" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground max-w-[200px] truncate block">
                      {webhook.url || "-"}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(webhook.events || []).length > 0
                      ? webhook.events.map((evt: string) => (
                          <Badge key={evt} variant="outline" className="text-xs">
                            {evt}
                          </Badge>
                        ))
                      : <span className="text-xs text-muted-foreground">Todos</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={webhook.is_active ? "default" : "secondary"}
                  >
                    {webhook.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={webhook.is_active ? "Desativar webhook" : "Ativar webhook"}
                      onClick={() => handleToggleActive(webhook)}
                      disabled={saving}
                    >
                      {webhook.is_active ? (
                        <PowerOff className="size-3.5 text-destructive" />
                      ) : (
                        <Power className="size-3.5 text-success" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir webhook"
                      className="text-destructive"
                      onClick={() => setDeleteConfirm(webhook)}
                      disabled={saving}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border bg-card p-5">
            <DialogTitle className="sr-only">Excluir webhook</DialogTitle>
            <DialogHero
              icon={<Trash2 className="size-5" />}
              title="Excluir webhook"
              tagline={deleteConfirm ? `"${deleteConfirm.name}" será removido permanentemente.` : ""}
              tone="destructive"
            />
          </DialogHeader>
          <div className="flex justify-end gap-2 border-t border-border p-4">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Excluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border bg-card p-5">
            <DialogTitle className="sr-only">Novo Webhook</DialogTitle>
            <DialogHero
              icon={<Webhook className="size-5" />}
              title="Novo Webhook"
              tagline="Configure um webhook de entrada ou saída"
            />
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wh-name">Nome</Label>
              <Input
                id="wh-name"
                name="webhook_name"
                placeholder="Ex: Notificação Slack"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Direção</Label>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v ?? "outbound")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outbound">Saída (envia dados)</SelectItem>
                  <SelectItem value="inbound">Entrada (recebe dados)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {direction === "outbound" && (
              <div className="space-y-2">
                <Label htmlFor="wh-url">URL de destino</Label>
                <Input
                  id="wh-url"
                  name="webhook_url"
                  placeholder="https://exemplo.com/webhook"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            )}
            {direction === "inbound" && (
              <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                Um token sera gerado automaticamente para autenticar as
                requisicoes de entrada.
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="wh-events">
                Eventos (separados por virgula, vazio = todos)
              </Label>
              <Input
                id="wh-events"
                name="webhook_events"
                placeholder="lead.created, lead.updated, message.received"
                value={events}
                onChange={(e) => setEvents(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={saving || !name.trim() || (direction === "outbound" && !url.trim())}
              >
                {saving ? "Criando..." : "Criar Webhook"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
