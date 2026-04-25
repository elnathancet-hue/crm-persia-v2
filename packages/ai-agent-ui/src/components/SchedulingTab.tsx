"use client";

import * as React from "react";
import {
  Calendar,
  Clock,
  Filter,
  Loader2,
  Pencil,
  PlayCircle,
  PauseCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  isValidCronShape,
  SCHEDULED_JOBS_MAX_PER_AGENT,
  SCHEDULED_JOB_CRON_PRESETS,
  type AgentNotificationTemplate,
  type AgentScheduledJob,
  type LeadFilter,
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
import { cn } from "@persia/ui/utils";
import { useAgentActions } from "../context";

interface Props {
  configId: string;
  jobs: AgentScheduledJob[];
  templates: AgentNotificationTemplate[];
  onChange: (jobs: AgentScheduledJob[]) => void;
  onRefresh: () => Promise<void>;
}

interface EditorState {
  open: boolean;
  source: AgentScheduledJob | null;
  name: string;
  template_id: string;
  cron_expr: string;
  cron_preset: string; // "" = custom
  lead_filter: LeadFilter;
}

const EMPTY_EDITOR: EditorState = {
  open: false,
  source: null,
  name: "",
  template_id: "",
  cron_expr: "0 9 * * *",
  cron_preset: "0 9 * * *",
  lead_filter: { only_active_agents: true },
};

export function SchedulingTab({
  configId,
  jobs,
  templates,
  onChange,
  onRefresh,
}: Props) {
  const { createScheduledJob, updateScheduledJob, deleteScheduledJob } =
    useAgentActions();
  const [editor, setEditor] = React.useState<EditorState>(EMPTY_EDITOR);
  const [isPending, startTransition] = React.useTransition();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const limitReached = jobs.length >= SCHEDULED_JOBS_MAX_PER_AGENT;
  const activeTemplates = templates.filter((t) => t.status === "active");

  const openCreate = () => {
    setEditor({
      ...EMPTY_EDITOR,
      open: true,
      template_id: activeTemplates[0]?.id ?? "",
    });
  };

  const openEdit = (job: AgentScheduledJob) => {
    const matchingPreset = SCHEDULED_JOB_CRON_PRESETS.find(
      (p) => p.expr === job.cron_expr,
    );
    setEditor({
      open: true,
      source: job,
      name: job.name,
      template_id: job.template_id,
      cron_expr: job.cron_expr,
      cron_preset: matchingPreset ? job.cron_expr : "",
      lead_filter: job.lead_filter,
    });
  };

  const handleSave = () => {
    const name = editor.name.trim();
    if (!name) {
      toast.error("Informe um nome");
      return;
    }
    if (!editor.template_id) {
      toast.error("Selecione um template");
      return;
    }
    if (!isValidCronShape(editor.cron_expr)) {
      toast.error("Expressão cron inválida");
      return;
    }

    startTransition(async () => {
      try {
        if (editor.source) {
          const updated = await updateScheduledJob(editor.source.id, {
            name,
            template_id: editor.template_id,
            cron_expr: editor.cron_expr,
            lead_filter: editor.lead_filter,
          });
          onChange(jobs.map((j) => (j.id === updated.id ? updated : j)));
          toast.success("Agendamento atualizado");
        } else {
          const created = await createScheduledJob({
            config_id: configId,
            name,
            template_id: editor.template_id,
            cron_expr: editor.cron_expr,
            lead_filter: editor.lead_filter,
          });
          onChange([...jobs, created]);
          toast.success("Agendamento criado");
        }
        setEditor(EMPTY_EDITOR);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao salvar");
      }
    });
  };

  const handleDelete = (job: AgentScheduledJob) => {
    if (!window.confirm(`Apagar agendamento "${job.name}"?`)) return;
    setDeletingId(job.id);
    startTransition(async () => {
      try {
        await deleteScheduledJob(job.id);
        onChange(jobs.filter((j) => j.id !== job.id));
        toast.success("Agendamento removido");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover");
      } finally {
        setDeletingId(null);
      }
    });
  };

  const handleToggleStatus = (job: AgentScheduledJob) => {
    const next = job.status === "active" ? "paused" : "active";
    startTransition(async () => {
      try {
        const updated = await updateScheduledJob(job.id, { status: next });
        onChange(jobs.map((j) => (j.id === updated.id ? updated : j)));
        toast.success(
          next === "paused" ? "Agendamento pausado" : "Agendamento retomado",
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao atualizar");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Calendar className="size-5 text-primary" />
            <h2 className="font-semibold">Agendamentos</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Dispare templates de notificação em horários programados.
            Filtra leads por critério e envia em massa — bom pra lembretes
            de follow-up, boas-vindas e reengajamento.
          </p>
        </div>
        <Button
          onClick={openCreate}
          disabled={isPending || limitReached || activeTemplates.length === 0}
          title={
            activeTemplates.length === 0
              ? "Crie ao menos um template ativo na aba Notificações primeiro"
              : limitReached
                ? `Limite de ${SCHEDULED_JOBS_MAX_PER_AGENT} agendamentos atingido`
                : undefined
          }
        >
          <Plus className="size-4" />
          Novo agendamento
        </Button>
      </div>

      {activeTemplates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
              <Calendar className="size-6 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-1">
              <p className="font-semibold text-sm tracking-tight">
                Primeiro crie um template de notificação
              </p>
              <p className="text-xs text-muted-foreground">
                Agendamentos disparam templates existentes. Vá na aba{" "}
                <strong>Notificações</strong> e crie pelo menos um template
                ativo antes de agendar.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : jobs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
              <Calendar className="size-6 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-1">
              <p className="font-semibold text-sm tracking-tight">
                Automatize lembretes recorrentes
              </p>
              <p className="text-xs text-muted-foreground">
                Envie mensagem pra leads que entraram ha X dias, boas-vindas
                no inicio da semana, follow-up nos que pararam de responder —
                tudo sem precisar acionar o agente em conversa.
              </p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Criar primeiro agendamento
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <ScheduledJobCard
              key={job.id}
              job={job}
              template={templates.find((t) => t.id === job.template_id)}
              onEdit={() => openEdit(job)}
              onDelete={() => handleDelete(job)}
              onToggle={() => handleToggleStatus(job)}
              deleting={deletingId === job.id}
              disabled={isPending}
            />
          ))}
        </div>
      )}

      <SchedulingEditorDialog
        editor={editor}
        templates={activeTemplates}
        onChange={setEditor}
        onSave={handleSave}
        isPending={isPending}
      />
    </div>
  );
}

interface CardProps {
  job: AgentScheduledJob;
  template: AgentNotificationTemplate | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  deleting: boolean;
  disabled: boolean;
}

function ScheduledJobCard({
  job,
  template,
  onEdit,
  onDelete,
  onToggle,
  deleting,
  disabled,
}: CardProps) {
  const presetLabel = SCHEDULED_JOB_CRON_PRESETS.find(
    (p) => p.expr === job.cron_expr,
  )?.label;

  return (
    <Card className="transition-shadow hover:shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm truncate tracking-tight">
                {job.name}
              </p>
              {job.status === "paused" ? (
                <Badge variant="outline" className="text-xs">
                  Pausado
                </Badge>
              ) : null}
              {template ? (
                <Badge
                  variant="outline"
                  className="text-xs gap-1 font-mono"
                  title="Template disparado"
                >
                  {template.name}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-xs bg-destructive/10 text-destructive border-transparent"
                  title="Template deletado ou arquivado — job não dispara"
                >
                  template ausente
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
              <Clock className="size-3" />
              <span>{presetLabel ?? <code className="font-mono">{job.cron_expr}</code>}</span>
              {job.last_run_at ? (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    Última: {new Date(job.last_run_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              ) : null}
              {job.last_run_leads_processed > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{job.last_run_leads_processed} lead(s)</span>
                </>
              ) : null}
            </div>
            <LeadFilterSummary filter={job.lead_filter} />
            {job.last_run_error ? (
              <p className="text-xs text-destructive line-clamp-1">
                Erro: {job.last_run_error}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={job.status === "active" ? "Pausar" : "Retomar"}
              onClick={onToggle}
              disabled={disabled}
            >
              {job.status === "active" ? (
                <PauseCircle className="size-4" />
              ) : (
                <PlayCircle className="size-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="Editar"
              onClick={onEdit}
              disabled={disabled}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="Apagar"
              onClick={onDelete}
              disabled={disabled}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LeadFilterSummary({ filter }: { filter: LeadFilter }) {
  const parts: string[] = [];
  if (filter.tag_slugs && filter.tag_slugs.length > 0) {
    parts.push(`tag: ${filter.tag_slugs.join(", ")}`);
  }
  if (filter.pipeline_stage_ids && filter.pipeline_stage_ids.length > 0) {
    parts.push(`${filter.pipeline_stage_ids.length} etapa(s)`);
  }
  if (filter.statuses && filter.statuses.length > 0) {
    parts.push(`status: ${filter.statuses.join(", ")}`);
  }
  if (filter.age_days) {
    const { days, comparison } = filter.age_days;
    const op = comparison === "gt" || comparison === "gte" ? "há mais de" : "há menos de";
    parts.push(`${op} ${days} dias`);
  }
  if (filter.only_active_agents) parts.push("bot ativo");
  if (filter.silence_recent_hours) {
    parts.push(`silêncio ${filter.silence_recent_hours}h`);
  }

  if (parts.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
      <Filter className="size-3" />
      <span className="line-clamp-1">{parts.join(" · ")}</span>
    </div>
  );
}

interface EditorDialogProps {
  editor: EditorState;
  templates: AgentNotificationTemplate[];
  onChange: React.Dispatch<React.SetStateAction<EditorState>>;
  onSave: () => void;
  isPending: boolean;
}

function SchedulingEditorDialog({
  editor,
  templates,
  onChange,
  onSave,
  isPending,
}: EditorDialogProps) {
  const handleCronPreset = (value: string | null) => {
    const normalized = value ?? "";
    onChange((prev) => ({
      ...prev,
      cron_preset: normalized,
      cron_expr: normalized || prev.cron_expr,
    }));
  };

  const updateFilter = (updater: (f: LeadFilter) => LeadFilter) => {
    onChange((prev) => ({ ...prev, lead_filter: updater(prev.lead_filter) }));
  };

  return (
    <Dialog
      open={editor.open}
      onOpenChange={(open) => {
        if (!open) onChange(EMPTY_EDITOR);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editor.source ? "Editar agendamento" : "Novo agendamento"}
          </DialogTitle>
          <DialogDescription>
            O scheduler roda o template selecionado no horário programado,
            disparando uma mensagem pra cada lead que bate com o filtro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sched-name">Nome</Label>
            <Input
              id="sched-name"
              value={editor.name}
              onChange={(e) =>
                onChange((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="Ex: Follow-up 3 dias"
              disabled={isPending}
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sched-template">Template a disparar</Label>
            <Select
              value={editor.template_id}
              onValueChange={(v) =>
                onChange((prev) => ({ ...prev, template_id: v ?? "" }))
              }
              disabled={isPending}
            >
              <SelectTrigger id="sched-template">
                <SelectValue placeholder="Selecione um template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sched-cron">Quando disparar</Label>
            <Select
              value={editor.cron_preset}
              onValueChange={handleCronPreset}
              disabled={isPending}
            >
              <SelectTrigger id="sched-cron">
                <SelectValue placeholder="Personalizado" />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULED_JOB_CRON_PRESETS.map((p) => (
                  <SelectItem key={p.expr} value={p.expr}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="">Personalizado</SelectItem>
              </SelectContent>
            </Select>
            {editor.cron_preset === "" ? (
              <Input
                value={editor.cron_expr}
                onChange={(e) =>
                  onChange((prev) => ({ ...prev, cron_expr: e.target.value }))
                }
                placeholder="0 9 * * *"
                disabled={isPending}
                className="font-mono text-sm"
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              Formato cron com 5 campos: minuto, hora, dia, mês, dia-da-semana. Horários em UTC.
            </p>
          </div>

          <div className="space-y-2 pt-2 border-t border-border/50">
            <Label>Filtro de leads</Label>
            <p className="text-xs text-muted-foreground">
              Só leads que batem com TODOS os critérios recebem a mensagem.
            </p>

            <LeadFilterForm
              filter={editor.lead_filter}
              onChange={updateFilter}
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onChange(EMPTY_EDITOR)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface LeadFilterFormProps {
  filter: LeadFilter;
  onChange: (updater: (f: LeadFilter) => LeadFilter) => void;
  disabled: boolean;
}

function LeadFilterForm({ filter, onChange, disabled }: LeadFilterFormProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-4 bg-muted/20">
      <FilterRow
        label="Só leads com bot ativo"
        help="Pula leads transferidos pra humano"
        value={filter.only_active_agents ?? false}
        onChange={(v) =>
          onChange((prev) => ({ ...prev, only_active_agents: v }))
        }
        disabled={disabled}
      />

      <div className="space-y-1.5 pt-3 border-t border-border/40">
        <Label htmlFor="filter-silence" className="text-xs">
          Silêncio recente (horas)
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="filter-silence"
            type="number"
            min={0}
            max={720}
            placeholder="0"
            value={filter.silence_recent_hours ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onChange((prev) => ({
                ...prev,
                silence_recent_hours: v ? Math.max(0, parseInt(v, 10)) : undefined,
              }));
            }}
            disabled={disabled}
            className="w-28"
          />
          <span className="text-xs text-muted-foreground">
            Pula leads que receberam mensagem nas últimas N horas
          </span>
        </div>
      </div>

      <div className="space-y-1.5 pt-3 border-t border-border/40">
        <Label htmlFor="filter-age" className="text-xs">
          Idade do lead
        </Label>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={filter.age_days?.comparison ?? ""}
            onValueChange={(v) => {
              const next = v ?? "";
              onChange((prev) => {
                if (!next) return { ...prev, age_days: undefined };
                return {
                  ...prev,
                  age_days: {
                    comparison: next as "gt" | "gte" | "lt" | "lte",
                    days: prev.age_days?.days ?? 7,
                  },
                };
              });
            }}
            disabled={disabled}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Qualquer idade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Qualquer idade</SelectItem>
              <SelectItem value="gte">criado há pelo menos</SelectItem>
              <SelectItem value="gt">criado há mais de</SelectItem>
              <SelectItem value="lte">criado há no máximo</SelectItem>
              <SelectItem value="lt">criado há menos de</SelectItem>
            </SelectContent>
          </Select>
          {filter.age_days ? (
            <>
              <Input
                id="filter-age"
                type="number"
                min={0}
                max={3650}
                value={filter.age_days.days}
                onChange={(e) => {
                  const n = Math.max(0, parseInt(e.target.value, 10) || 0);
                  onChange((prev) => ({
                    ...prev,
                    age_days: prev.age_days
                      ? { ...prev.age_days, days: n }
                      : { comparison: "gte", days: n },
                  }));
                }}
                disabled={disabled}
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">dias</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5 pt-3 border-t border-border/40">
        <Label htmlFor="filter-tags" className="text-xs">
          Tags (separadas por vírgula)
        </Label>
        <Input
          id="filter-tags"
          value={(filter.tag_slugs ?? []).join(", ")}
          onChange={(e) => {
            const slugs = e.target.value
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean);
            onChange((prev) => ({
              ...prev,
              tag_slugs: slugs.length > 0 ? slugs : undefined,
            }));
          }}
          placeholder="Ex: quente, demo-solicitada"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

interface FilterRowProps {
  label: string;
  help: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}

function FilterRow({ label, help, value, onChange, disabled }: FilterRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{help}</p>
      </div>
      <Switch
        checked={value}
        onCheckedChange={(v) => onChange(Boolean(v))}
        disabled={disabled}
      />
    </div>
  );
}
