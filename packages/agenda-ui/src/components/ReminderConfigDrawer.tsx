"use client";

import * as React from "react";
import { Bell, Loader2 } from "lucide-react";
import {
  type AgendaReminderConfig,
  type ReminderTriggerWhen,
  REMINDER_TEMPLATE_VARIABLES,
  renderReminderTemplate,
} from "@persia/shared/agenda";
import { Button } from "@persia/ui/button";
import { Checkbox } from "@persia/ui/checkbox";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
import { Textarea } from "@persia/ui/textarea";

interface ReminderConfigDrawerProps {
  open: boolean;
  existing?: AgendaReminderConfig | null;
  onClose: () => void;
  onSave: (input: ExistingPayload) => Promise<void>;
}

export interface ExistingPayload {
  name: string;
  trigger_when: ReminderTriggerWhen;
  trigger_offset_minutes: number;
  template_text: string;
  is_active: boolean;
}

const PRESETS_MIN: { label: string; value: number }[] = [
  { label: "15 minutos antes", value: 15 },
  { label: "30 minutos antes", value: 30 },
  { label: "1 hora antes", value: 60 },
  { label: "2 horas antes", value: 120 },
  { label: "12 horas antes", value: 720 },
  { label: "1 dia antes (24h)", value: 1440 },
  { label: "2 dias antes (48h)", value: 2880 },
  { label: "1 semana antes", value: 10080 },
];

const CUSTOM_OFFSET = "__custom__";

const PREVIEW_VARS = {
  lead_name: "Carlos",
  appointment_title: "Consulta inicial",
  appointment_date: "04/05/2026",
  appointment_time: "09:00",
  appointment_weekday: "segunda-feira",
  appointment_location: "Rua Sete, 123",
  appointment_meeting_url: "https://meet.google.com/xxx",
  duration_minutes: "60",
  organization_name: "Clínica Persia",
  host_name: "Juliana",
};

export const ReminderConfigDrawer: React.FC<ReminderConfigDrawerProps> = ({
  open,
  existing = null,
  onClose,
  onSave,
}) => {
  const isEdit = Boolean(existing);

  const [name, setName] = React.useState(existing?.name ?? "");
  const [triggerWhen, setTriggerWhen] = React.useState<ReminderTriggerWhen>(
    existing?.trigger_when ?? "before_start",
  );
  const [offset, setOffset] = React.useState(
    existing?.trigger_offset_minutes ?? 60,
  );
  const [text, setText] = React.useState(existing?.template_text ?? "");
  const [isActive, setIsActive] = React.useState(existing?.is_active ?? true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setName(existing?.name ?? "");
    setTriggerWhen(existing?.trigger_when ?? "before_start");
    setOffset(existing?.trigger_offset_minutes ?? 60);
    setText(existing?.template_text ?? "");
    setIsActive(existing?.is_active ?? true);
    setError(null);
  }, [existing, open]);

  const errors = React.useMemo(() => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Nome obrigatório";
    if (!text.trim()) e.text = "Mensagem obrigatória";
    if (text.length > 1500) e.text = "Máximo 1500 caracteres";
    if (
      triggerWhen === "before_start" &&
      (offset < 5 || offset > 10080)
    )
      e.offset = "Entre 5 minutos e 7 dias (10080 min)";
    return e;
  }, [name, text, triggerWhen, offset]);

  const isValid = Object.keys(errors).length === 0;
  const preview = React.useMemo(
    () => renderReminderTemplate(text, PREVIEW_VARS),
    [text],
  );

  const offsetIsPreset = PRESETS_MIN.some((p) => p.value === offset);

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        trigger_when: triggerWhen,
        trigger_offset_minutes: triggerWhen === "on_create" ? 0 : offset,
        template_text: text,
        is_active: isActive,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSubmitting(false);
    }
  };

  const dialogTitle = isEdit ? "Editar lembrete" : "Novo lembrete";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border bg-card p-5">
          <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
          <DialogHero
            icon={<Bell className="size-5" />}
            title={dialogTitle}
            tagline="Mensagem automática via WhatsApp"
          />
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="space-y-1.5">
            <Label htmlFor="rem-name">Nome interno</Label>
            <Input
              id="rem-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Lembrete 24h antes"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rem-when">Quando enviar</Label>
            <Select
              value={triggerWhen}
              onValueChange={(v) =>
                v && setTriggerWhen(v as ReminderTriggerWhen)
              }
            >
              <SelectTrigger id="rem-when" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on_create">
                  Confirmação imediata (logo após o agendamento)
                </SelectItem>
                <SelectItem value="before_start">
                  Antes do horário do compromisso
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {triggerWhen === "before_start" && (
            <div className="space-y-1.5">
              <Label htmlFor="rem-offset">Quanto tempo antes</Label>
              <Select
                value={offsetIsPreset ? String(offset) : CUSTOM_OFFSET}
                onValueChange={(v) => {
                  if (!v || v === CUSTOM_OFFSET) return;
                  setOffset(Number(v));
                }}
              >
                <SelectTrigger id="rem-offset" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS_MIN.map((p) => (
                    <SelectItem key={p.value} value={String(p.value)}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_OFFSET}>Personalizado…</SelectItem>
                </SelectContent>
              </Select>
              {!offsetIsPreset && (
                <Input
                  type="number"
                  min={5}
                  max={10080}
                  value={offset}
                  onChange={(e) => setOffset(Number(e.target.value))}
                  placeholder="Minutos antes"
                  aria-invalid={Boolean(errors.offset)}
                />
              )}
              {errors.offset && (
                <p className="text-xs text-destructive">{errors.offset}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rem-text">Mensagem</Label>
            <Textarea
              id="rem-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Olá {{lead_name}}! Lembrete: {{appointment_title}} às {{appointment_time}}."
              aria-invalid={Boolean(errors.text)}
            />
            {errors.text && (
              <p className="text-xs text-destructive">{errors.text}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Variáveis disponíveis (clique pra inserir):
            </p>
            <div className="flex flex-wrap gap-1">
              {REMINDER_TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setText((t) => `${t}{{${v}}}`)}
                  className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-1.5">
            <Label>Preview</Label>
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {preview || (
                  <span className="italic text-muted-foreground">
                    (vazio — a mensagem aparecerá aqui)
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="rem-active"
              checked={isActive}
              onCheckedChange={(c) => setIsActive(c === true)}
            />
            <Label
              htmlFor="rem-active"
              className="cursor-pointer font-medium"
            >
              Ativo
            </Label>
            <span className="text-xs text-muted-foreground">
              (desativado: continua salvo mas não dispara)
            </span>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/30">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border bg-card p-4 flex-row justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !isValid}
          >
            {submitting ? <Loader2 className="animate-spin" /> : <Bell />}
            {submitting ? "Salvando..." : isEdit ? "Salvar" : "Criar lembrete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
