"use client";

import * as React from "react";
import { Clock, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  formatFollowupDelay,
  FOLLOWUPS_MAX_PER_AGENT,
  FOLLOWUP_DELAY_HOURS_MAX,
  FOLLOWUP_DELAY_HOURS_MIN,
  FOLLOWUP_DELAY_PRESETS,
  FOLLOWUP_NAME_MAX_CHARS,
  validateFollowupInput,
  type AgentFollowup,
  type AgentNotificationTemplate,
} from "@persia/shared/ai-agent";
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
  delay_hours: number;
  delay_preset: string; // "" = custom
}

const EMPTY_EDITOR: EditorState = {
  open: false,
  source: null,
  name: "",
  template_id: "",
  delay_hours: 24,
  delay_preset: "24",
};

export function FollowupTab({ configId, followups, templates, onChange }: Props) {
  const { createFollowup, updateFollowup, deleteFollowup, toggleFollowup } =
    useAgentActions();
  const [editor, setEditor] = React.useState<EditorState>(EMPTY_EDITOR);
  const [deleteTarget, setDeleteTarget] = React.useState<AgentFollowup | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const activeTemplates = React.useMemo(
    () => templates.filter((t) => t.status === "active"),
    [templates],
  );

  const sorted = React.useMemo(
    () => followups.slice().sort((a, b) => a.order_index - b.order_index),
    [followups],
  );

  const reachedCap = sorted.length >= FOLLOWUPS_MAX_PER_AGENT;

  const openNew = () => {
    setEditor({
      ...EMPTY_EDITOR,
      open: true,
      template_id: activeTemplates[0]?.id ?? "",
      // Sugere delay próximo (24h, 48h, 72h...) baseado no que já existe.
      delay_hours: nextSuggestedDelay(sorted),
      delay_preset: String(nextSuggestedDelay(sorted)),
    });
  };

  const openEdit = (followup: AgentFollowup) => {
    const matchingPreset = FOLLOWUP_DELAY_PRESETS.find(
      (p) => p.hours === followup.delay_hours,
    );
    setEditor({
      open: true,
      source: followup,
      name: followup.name,
      template_id: followup.template_id,
      delay_hours: followup.delay_hours,
      delay_preset: matchingPreset ? String(followup.delay_hours) : "",
    });
  };

  const errors = React.useMemo(
    () =>
      validateFollowupInput({
        name: editor.name,
        template_id: editor.template_id,
        delay_hours: editor.delay_hours,
      }),
    [editor.name, editor.template_id, editor.delay_hours],
  );
  const hasErrors = Object.keys(errors).length > 0;

  const handleSave = () => {
    if (hasErrors) return;
    startTransition(async () => {
      try {
        if (editor.source) {
          const updated = await updateFollowup(editor.source.id, {
            name: editor.name,
            template_id: editor.template_id,
            delay_hours: editor.delay_hours,
          });
          onChange(followups.map((f) => (f.id === updated.id ? updated : f)));
          toast.success("Follow-up atualizado");
        } else {
          const created = await createFollowup({
            config_id: configId,
            name: editor.name,
            template_id: editor.template_id,
            delay_hours: editor.delay_hours,
          });
          onChange([...followups, created]);
          toast.success("Follow-up criado");
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
        toast.success("Follow-up removido");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover");
      } finally {
        setPendingId(null);
      }
    });
  };

  const handlePresetChange = (value: string | null) => {
    if (!value) {
      // "Personalizado": mantem hours atual.
      setEditor((e) => ({ ...e, delay_preset: "" }));
      return;
    }
    const hours = Number(value);
    if (!Number.isFinite(hours)) return;
    setEditor((e) => ({ ...e, delay_preset: value, delay_hours: hours }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            <h2 className="font-semibold">Follow-up automático</h2>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Configure mensagens de acompanhamento para manter seus leads engajados.
            Disparam automaticamente após X horas sem resposta do lead em uma conversa.
          </p>
        </div>
        <Button onClick={openNew} disabled={reachedCap || activeTemplates.length === 0}>
          <Plus className="size-4" />
          Adicionar follow-up
        </Button>
      </div>

      {activeTemplates.length === 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">Nenhum template de notificação ativo</p>
            <p className="text-muted-foreground mt-0.5">
              Crie um template na aba <strong>Notificações</strong> antes de
              configurar follow-ups.
            </p>
          </CardContent>
        </Card>
      ) : sorted.length === 0 ? (
        <EmptyFollowups onCreate={openNew} />
      ) : (
        <div className="space-y-2">
          {sorted.map((followup) => {
            const template = templates.find((t) => t.id === followup.template_id);
            return (
              <Card key={followup.id} className="transition-shadow hover:shadow-sm">
                <CardContent className="p-4 flex items-start gap-4">
                  <div className="size-10 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Clock className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="font-semibold text-sm tracking-tight">
                      {followup.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Após <strong>{formatFollowupDelay(followup.delay_hours)}</strong> sem
                      resposta · template{" "}
                      <span className="font-mono text-foreground/80">
                        {template?.name ?? "(removido)"}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={followup.is_enabled}
                      onCheckedChange={(v) => handleToggle(followup, v)}
                      disabled={pendingId === followup.id || isPending}
                      aria-label={
                        followup.is_enabled ? "Desativar follow-up" : "Ativar follow-up"
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      onClick={() => openEdit(followup)}
                      disabled={isPending}
                      aria-label={`Editar ${followup.name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      onClick={() => setDeleteTarget(followup)}
                      disabled={isPending}
                      aria-label={`Remover ${followup.name}`}
                    >
                      {pendingId === followup.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {reachedCap ? (
            <p className="text-xs text-muted-foreground text-center pt-2">
              Limite de {FOLLOWUPS_MAX_PER_AGENT} follow-ups por agente atingido.
              Remova um antes de criar outro.
            </p>
          ) : null}
        </div>
      )}

      <Dialog
        open={editor.open}
        onOpenChange={(open) => !open && setEditor(EMPTY_EDITOR)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor.source ? "Editar follow-up" : "Novo follow-up"}
            </DialogTitle>
            <DialogDescription>
              Quando uma conversa fica inativa pelo tempo configurado, o agente
              dispara o template selecionado pra reativar o lead.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="followup-name">Nome</Label>
              <Input
                id="followup-name"
                value={editor.name}
                onChange={(e) =>
                  setEditor((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Ex: Lembrete 24h sem resposta"
                maxLength={FOLLOWUP_NAME_MAX_CHARS}
                disabled={isPending}
                aria-invalid={!!errors.name}
                className={
                  errors.name
                    ? "border-destructive focus-visible:ring-destructive/40"
                    : undefined
                }
              />
              {errors.name ? (
                <p className="text-xs text-destructive">{errors.name}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="followup-template">Template a disparar</Label>
              <Select
                value={editor.template_id}
                onValueChange={(v) =>
                  setEditor((prev) => ({ ...prev, template_id: v ?? "" }))
                }
                disabled={isPending}
              >
                <SelectTrigger
                  id="followup-template"
                  aria-invalid={!!errors.template_id}
                  className={errors.template_id ? "border-destructive" : undefined}
                >
                  <SelectValue placeholder="Selecione um template">
                    {activeTemplates.find((t) => t.id === editor.template_id)?.name ??
                      "Selecione um template"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeTemplates.length === 0 ? (
                    <SelectItem value="_empty" disabled>
                      Nenhum template ativo
                    </SelectItem>
                  ) : (
                    activeTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {errors.template_id ? (
                <p className="text-xs text-destructive">{errors.template_id}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="followup-delay">Disparar após</Label>
              <Select
                value={editor.delay_preset}
                onValueChange={handlePresetChange}
                disabled={isPending}
              >
                <SelectTrigger id="followup-delay">
                  <SelectValue placeholder="Personalizado">
                    {FOLLOWUP_DELAY_PRESETS.find(
                      (p) => String(p.hours) === editor.delay_preset,
                    )?.label ??
                      (editor.delay_preset === ""
                        ? `Personalizado (${formatFollowupDelay(editor.delay_hours)})`
                        : `${editor.delay_hours} horas`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FOLLOWUP_DELAY_PRESETS.map((p) => (
                    <SelectItem key={p.hours} value={String(p.hours)}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="">Personalizado</SelectItem>
                </SelectContent>
              </Select>
              {editor.delay_preset === "" ? (
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
                  aria-invalid={!!errors.delay_hours}
                  className={cn(
                    errors.delay_hours &&
                      "border-destructive focus-visible:ring-destructive/40",
                  )}
                />
              ) : null}
              {errors.delay_hours ? (
                <p className="text-xs text-destructive">{errors.delay_hours}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Disparado se o lead ficar{" "}
                  <strong>{formatFollowupDelay(editor.delay_hours)}</strong> sem responder.
                  O contador zera a cada nova mensagem do lead.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditor(EMPTY_EDITOR)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isPending || hasErrors}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
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
            <DialogTitle>Remover follow-up?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? (
                <>
                  O follow-up <strong>{deleteTarget.name}</strong> não será mais
                  disparado. Conversas que ja receberam o lembrete não são
                  afetadas. Esta ação não pode ser desfeita.
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
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          <p className="font-semibold text-sm">Mantenha leads engajados</p>
          <p className="text-xs text-muted-foreground">
            Crie lembretes em cascata (24h, 48h, 72h sem resposta...) que reativam
            conversas automaticamente. O contador zera a cada nova mensagem do
            lead — sem spam.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          Criar primeiro follow-up
        </Button>
      </CardContent>
    </Card>
  );
}

// Sugere o proximo delay tipico baseado no que ja existe (cascade
// 24h → 48h → 72h → 1 semana). Se cliente ja tem 24+48+72, sugere 168.
function nextSuggestedDelay(existing: AgentFollowup[]): number {
  const used = new Set(existing.map((f) => f.delay_hours));
  for (const preset of FOLLOWUP_DELAY_PRESETS) {
    if (!used.has(preset.hours)) return preset.hours;
  }
  return 24; // fallback se cliente preencheu todos os presets
}
