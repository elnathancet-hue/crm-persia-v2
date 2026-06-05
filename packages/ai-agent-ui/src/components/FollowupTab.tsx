"use client";

import * as React from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatFollowupDelay,
  FOLLOWUP_DEFAULT_SEND_WINDOW_END,
  FOLLOWUP_DEFAULT_SEND_WINDOW_START,
  FOLLOWUPS_MAX_PER_AGENT,
  FOLLOWUP_DELAY_HOURS_MAX,
  FOLLOWUP_DELAY_HOURS_MIN,
  FOLLOWUP_DELAY_PRESETS,
  FOLLOWUP_NAME_MAX_CHARS,
  validateFollowupInput,
  type AgentFollowup,
  type AgentNotificationTemplate,
} from "@persia/shared/ai-agent";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Switch } from "@persia/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@persia/ui/table";
import { Textarea } from "@persia/ui/textarea";
import { cn } from "@persia/ui/utils";
import { useAgentActions } from "../context";

interface Props {
  configId: string;
  followups: AgentFollowup[];
  templates: AgentNotificationTemplate[];
  onChange: (next: AgentFollowup[]) => void;
}

interface EditorState {
  open: boolean;
  source: AgentFollowup | null;
  name: string;
  template_id: string;
  message_text: string;
  delay_hours: number;
  delay_preset: string;
  send_window_start: string;
  send_window_end: string;
}

const EMPTY_EDITOR: EditorState = {
  open: false,
  source: null,
  name: "",
  template_id: "",
  message_text: "",
  delay_hours: 24,
  delay_preset: "24",
  send_window_start: FOLLOWUP_DEFAULT_SEND_WINDOW_START,
  send_window_end: FOLLOWUP_DEFAULT_SEND_WINDOW_END,
};

export function FollowupTab({ configId, followups, templates, onChange }: Props) {
  const { createFollowup, updateFollowup, deleteFollowup, toggleFollowup } =
    useAgentActions();
  const [editor, setEditor] = React.useState<EditorState>(EMPTY_EDITOR);
  const [deleteTarget, setDeleteTarget] = React.useState<AgentFollowup | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const sorted = React.useMemo(
    () => followups.slice().sort((a, b) => a.order_index - b.order_index),
    [followups],
  );

  const reachedCap = sorted.length >= FOLLOWUPS_MAX_PER_AGENT;

  const openNew = () => {
    const suggestedDelay = nextSuggestedDelay(sorted);
    setEditor({
      ...EMPTY_EDITOR,
      open: true,
      delay_hours: suggestedDelay,
      delay_preset: String(suggestedDelay),
    });
  };

  const openEdit = (followup: AgentFollowup) => {
    const matchingPreset = FOLLOWUP_DELAY_PRESETS.find(
      (preset) => preset.hours === followup.delay_hours,
    );
    setEditor({
      open: true,
      source: followup,
      name: followup.name,
      template_id: followup.template_id ?? "",
      message_text:
        followup.message_text ??
        templates.find((template) => template.id === followup.template_id)?.body_template ??
        "",
      delay_hours: followup.delay_hours,
      delay_preset: matchingPreset ? String(followup.delay_hours) : "custom",
      send_window_start:
        followup.send_window_start ?? FOLLOWUP_DEFAULT_SEND_WINDOW_START,
      send_window_end: followup.send_window_end ?? FOLLOWUP_DEFAULT_SEND_WINDOW_END,
    });
  };

  const errors = React.useMemo(
    () =>
      validateFollowupInput({
        name: editor.name,
        template_id: editor.template_id,
        message_text: editor.message_text,
        delay_hours: editor.delay_hours,
        send_window_start: editor.send_window_start,
        send_window_end: editor.send_window_end,
      }),
    [
      editor.name,
      editor.template_id,
      editor.message_text,
      editor.delay_hours,
      editor.send_window_start,
      editor.send_window_end,
    ],
  );
  const hasErrors = Object.keys(errors).length > 0;

  const handleSave = () => {
    if (hasErrors) return;
    startTransition(async () => {
      try {
        const payload = {
          name: editor.name,
          template_id: editor.template_id || null,
          message_text: editor.message_text,
          delay_hours: editor.delay_hours,
          send_window_start: editor.send_window_start,
          send_window_end: editor.send_window_end,
          require_ai_active: true,
        };
        if (editor.source) {
          const updated = await updateFollowup(editor.source.id, payload);
          onChange(followups.map((f) => (f.id === updated.id ? updated : f)));
          toast.success("Etapa atualizada");
        } else {
          const created = await createFollowup({ config_id: configId, ...payload });
          onChange([...followups, created]);
          toast.success("Etapa criada");
        }
        setEditor(EMPTY_EDITOR);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao salvar");
      }
    });
  };

  const handleToggle = (followup: AgentFollowup, enabled: boolean) => {
    setPendingId(followup.id);
    startTransition(async () => {
      try {
        const updated = await toggleFollowup(followup.id, enabled);
        onChange(followups.map((f) => (f.id === updated.id ? updated : f)));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao atualizar");
      } finally {
        setPendingId(null);
      }
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setPendingId(target.id);
    startTransition(async () => {
      try {
        await deleteFollowup(target.id);
        onChange(followups.filter((f) => f.id !== target.id));
        setDeleteTarget(null);
        toast.success("Etapa removida");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover");
      } finally {
        setPendingId(null);
      }
    });
  };

  const handlePresetChange = (value: string | null) => {
    const nextValue = value ?? "custom";
    if (nextValue === "custom") {
      setEditor((prev) => ({ ...prev, delay_preset: "custom" }));
      return;
    }
    const hours = Number(nextValue);
    if (!Number.isFinite(hours)) return;
    setEditor((prev) => ({ ...prev, delay_preset: nextValue, delay_hours: hours }));
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Bot className="size-3.5" />
              Automacao de conversa
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tight">
                Follow-up automatico
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Configure uma sequencia para quando o lead nao responder depois
                da ultima mensagem da empresa. Se o lead responder, a fila e
                cancelada automaticamente.
              </p>
            </div>
          </div>
          <Button onClick={openNew} disabled={reachedCap}>
            <Plus className="size-4" />
            Nova etapa
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <MetricCard
            label="Etapas ativas"
            value={String(sorted.filter((f) => f.is_enabled).length)}
          />
          <MetricCard
            label="Janela padrao"
            value={`${FOLLOWUP_DEFAULT_SEND_WINDOW_START}-${FOLLOWUP_DEFAULT_SEND_WINDOW_END}`}
          />
          <MetricCard label="Protecao" value="Cancela se lead responder" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <h3 className="font-semibold">Sequencia configurada</h3>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            As etapas rodam em ordem. Cada conversa so avanca para a proxima
            etapa se continuar sem resposta do lead.
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyFollowups onCreate={openNew} />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Status</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead>Gatilho</TableHead>
                <TableHead>Horário</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((followup) => {
                const template = templates.find((t) => t.id === followup.template_id);
                return (
                  <TableRow key={followup.id} className={pendingId === followup.id ? "opacity-50 pointer-events-none" : ""}>
                    <TableCell>
                      <Switch
                        checked={followup.is_enabled}
                        onCheckedChange={(v) => handleToggle(followup, v)}
                        disabled={pendingId === followup.id || isPending}
                        aria-label={followup.is_enabled ? "Desativar etapa" : "Ativar etapa"}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm">{followup.name}</span>
                        <span className="text-[11px] text-muted-foreground mt-0.5">
                          {followup.message_text?.trim() ? "Mensagem própria" : template?.name ?? "Template não encontrado"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      Após {formatFollowupDelay(followup.delay_hours)} s/ resposta
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">
                      {followup.send_window_start ?? "08:00"} - {followup.send_window_end ?? "18:00"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(followup)}
                          disabled={isPending}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(followup)}
                          disabled={isPending}
                        >
                          {pendingId === followup.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {reachedCap ? (
            <div className="border-t p-4 text-center">
              <p className="text-xs text-muted-foreground">
                Limite de {FOLLOWUPS_MAX_PER_AGENT} etapas atingido. Remova uma antes de criar outra.
              </p>
            </div>
          ) : null}
        </div>
      )}

      <Dialog
        open={editor.open}
        onOpenChange={(open) => !open && setEditor(EMPTY_EDITOR)}
      >
        <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-2xl flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 py-5">
            <DialogTitle>
              {editor.source ? "Editar etapa de follow-up" : "Nova etapa de follow-up"}
            </DialogTitle>
            <DialogDescription>
              Configure quando esta etapa entra na fila e qual mensagem sera enviada.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {/* Seção 1: Configuração Básica */}
            <div className="space-y-4 rounded-xl border p-5 bg-card">
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                <Label htmlFor="followup-name" className="text-xs font-semibold text-muted-foreground uppercase">Nome da etapa</Label>
                <Input
                  id="followup-name"
                  value={editor.name}
                  onChange={(e) =>
                    setEditor((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Ex: Lembrete 24h sem resposta"
                  maxLength={FOLLOWUP_NAME_MAX_CHARS}
                  disabled={isPending}
                  className={cn(
                    "h-10 font-medium",
                    errors.name && "border-destructive focus-visible:ring-destructive/40"
                  )}
                />
              </div>

              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                <Label htmlFor="followup-message" className="text-xs font-semibold text-muted-foreground uppercase">Mensagem</Label>
                <Textarea
                  id="followup-message"
                  value={editor.message_text}
                  onChange={(e) =>
                    setEditor((prev) => ({ ...prev, message_text: e.target.value }))
                  }
                  placeholder="Ex: Oi {{lead_name}}, passando para saber se posso te ajudar com mais alguma coisa."
                  rows={4}
                  disabled={isPending}
                  className={cn(
                    "resize-none text-sm p-3",
                    errors.message_text && "border-destructive focus-visible:ring-destructive/40",
                  )}
                />
                <p className="text-[10px] text-muted-foreground">
                  Variaveis: <span className="font-mono bg-muted px-1 py-0.5 rounded">{"{{lead_name}}"}</span>, <span className="font-mono bg-muted px-1 py-0.5 rounded">{"{{lead_phone}}"}</span>, <span className="font-mono bg-muted px-1 py-0.5 rounded">{"{{agent_name}}"}</span>.
                </p>
              </div>
            </div>

            {/* Seção 2: Regras de Envio */}
            <div className="space-y-6 rounded-xl border p-5 bg-card">
              <div className="space-y-1.5">
                <Label htmlFor="followup-delay" className="text-xs font-semibold text-muted-foreground uppercase">Entrar na fila após</Label>
                <div className="flex items-center gap-3">
                  <Select
                    value={editor.delay_preset}
                    onValueChange={handlePresetChange}
                    disabled={isPending}
                  >
                    <SelectTrigger id="followup-delay" className="w-[180px] h-10 font-medium">
                      <SelectValue placeholder="Personalizado">
                        {FOLLOWUP_DELAY_PRESETS.find(
                          (preset) => String(preset.hours) === editor.delay_preset,
                        )?.label ??
                          (editor.delay_preset === "custom"
                            ? `Personalizado (${formatFollowupDelay(editor.delay_hours)})`
                            : `${editor.delay_hours} horas`)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {FOLLOWUP_DELAY_PRESETS.map((preset) => (
                        <SelectItem key={preset.hours} value={String(preset.hours)}>
                          {preset.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Personalizado</SelectItem>
                    </SelectContent>
                  </Select>

                  {editor.delay_preset === "custom" && (
                    <div className="relative w-24">
                      <Input
                        type="number"
                        min={FOLLOWUP_DELAY_HOURS_MIN}
                        max={FOLLOWUP_DELAY_HOURS_MAX}
                        value={editor.delay_hours}
                        onChange={(e) =>
                          setEditor((prev) => ({
                            ...prev,
                            delay_hours: Number(e.target.value) || prev.delay_hours,
                          }))
                        }
                        disabled={isPending}
                        className={cn(
                          "h-10 text-center font-medium",
                          errors.delay_hours && "border-destructive focus-visible:ring-destructive/40",
                        )}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-semibold">h</span>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Tempo que o lead deve ficar sem resposta para ativar a etapa.
                </p>
              </div>

              <div className="space-y-1.5 pt-4 border-t">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Janela de Envio Seguro</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="followup-window-start"
                    type="time"
                    value={editor.send_window_start}
                    onChange={(e) =>
                      setEditor((prev) => ({ ...prev, send_window_start: e.target.value }))
                    }
                    disabled={isPending}
                    className="h-10 w-28 text-center font-medium"
                  />
                  <span className="text-muted-foreground text-sm font-semibold">até</span>
                  <Input
                    id="followup-window-end"
                    type="time"
                    value={editor.send_window_end}
                    onChange={(e) =>
                      setEditor((prev) => ({ ...prev, send_window_end: e.target.value }))
                    }
                    disabled={isPending}
                    className="h-10 w-28 text-center font-medium"
                  />
                </div>
                {errors.send_window ? (
                  <p className="text-[10px] text-destructive font-medium">{errors.send_window}</p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    Pausa envios automaticamente fora deste horário.
                  </p>
                )}
              </div>

              <div className="rounded-lg border bg-primary/5 border-primary/20 p-3 text-xs text-primary/80 flex items-start gap-2">
                <ShieldCheck className="size-4 shrink-0 mt-0.5" />
                <p>
                  <strong>Proteção fixa:</strong> antes de enviar, confirmamos se a IA continua ativa e se o lead não respondeu nesse meio tempo.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 px-6 py-4">
            <Button
              variant="outline"
              onClick={() => setEditor(EMPTY_EDITOR)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isPending || hasErrors}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar etapa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover etapa?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? (
                <>
                  A etapa <strong>{deleteTarget.name}</strong> nao sera mais
                  enviada. Conversas historicas continuam registradas.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <p className="text-[11px] font-semibold uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function EmptyFollowups({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center gap-3">
        <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
          <Clock className="size-6 text-muted-foreground" />
        </div>
        <div className="max-w-md space-y-1">
          <p className="font-semibold text-sm">Crie a primeira etapa</p>
          <p className="text-xs text-muted-foreground">
            Use uma sequencia simples, como 24h, 48h e 72h sem resposta.
            Cada envio revalida o estado da conversa antes de sair.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          Criar primeira etapa
        </Button>
      </CardContent>
    </Card>
  );
}

function nextSuggestedDelay(existing: AgentFollowup[]): number {
  const used = new Set(existing.map((f) => f.delay_hours));
  for (const preset of FOLLOWUP_DELAY_PRESETS) {
    if (!used.has(preset.hours)) return preset.hours;
  }
  return 24;
}
