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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import {
  createWebhook,
  deleteWebhook,
  toggleWebhookActive,
} from "@/actions/webhooks";

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
    } catch {
      // silently fail
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
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este webhook?")) return;
    setSaving(true);
    try {
      await deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch {
      // silently fail
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
              <TableHead>Direcao</TableHead>
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
                      <ArrowDownToLine className="size-3.5 text-blue-500" />
                    ) : (
                      <ArrowUpFromLine className="size-3.5 text-green-500" />
                    )}
                    <span className="text-sm">
                      {webhook.direction === "inbound" ? "Entrada" : "Saida"}
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
                      onClick={() => handleToggleActive(webhook)}
                      disabled={saving}
                    >
                      {webhook.is_active ? (
                        <PowerOff className="size-3.5 text-destructive" />
                      ) : (
                        <Power className="size-3.5 text-green-600" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => handleDelete(webhook.id)}
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Webhook</DialogTitle>
            <DialogDescription>
              Configure um webhook de entrada ou saida
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wh-name">Nome</Label>
              <Input
                id="wh-name"
                placeholder="Ex: Notificação Slack"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Direcao</Label>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v ?? "outbound")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outbound">Saida (envia dados)</SelectItem>
                  <SelectItem value="inbound">Entrada (recebe dados)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {direction === "outbound" && (
              <div className="space-y-2">
                <Label htmlFor="wh-url">URL de destino</Label>
                <Input
                  id="wh-url"
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
                placeholder="lead.created, lead.updated, message.received"
                value={events}
                onChange={(e) => setEvents(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              onClick={handleCreate}
              disabled={
                saving ||
                !name.trim() ||
                (direction === "outbound" && !url.trim())
              }
            >
              {saving ? "Criando..." : "Criar Webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
