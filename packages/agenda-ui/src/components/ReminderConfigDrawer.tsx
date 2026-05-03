"use client";

import * as React from "react";
import { Bell, Loader2, X } from "lucide-react";
import {
  type AgendaReminderConfig,
  type ReminderTriggerWhen,
  REMINDER_TEMPLATE_VARIABLES,
  renderReminderTemplate,
} from "@persia/shared/agenda";

interface ReminderConfigDrawerProps {
  open: boolean;
  existing?: AgendaReminderConfig | null;
  onClose: () => void;
  onSave: (
    input: ExistingPayload,
  ) => Promise<void>;
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
  const preview = React.useMemo(() => renderReminderTemplate(text, PREVIEW_VARS), [text]);

  if (!open) return null;

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

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="relative flex h-full w-full max-w-lg flex-col bg-card shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Bell size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black text-foreground">
                {isEdit ? "Editar lembrete" : "Novo lembrete"}
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Mensagem automática via WhatsApp
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-xl p-1.5 text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <Field label="Nome interno" error={errors.name}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Lembrete 24h antes"
              className={inputCls(errors.name)}
            />
          </Field>

          <Field label="Quando enviar">
            <select
              value={triggerWhen}
              onChange={(e) =>
                setTriggerWhen(e.target.value as ReminderTriggerWhen)
              }
              className={inputCls()}
            >
              <option value="on_create">Confirmação imediata (logo após o agendamento)</option>
              <option value="before_start">Antes do horário do compromisso</option>
            </select>
          </Field>

          {triggerWhen === "before_start" && (
            <Field label="Quanto tempo antes" error={errors.offset}>
              <div className="space-y-2">
                <select
                  value={
                    PRESETS_MIN.some((p) => p.value === offset) ? offset : "custom"
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "custom") return;
                    setOffset(Number(v));
                  }}
                  className={inputCls()}
                >
                  {PRESETS_MIN.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Personalizado…</option>
                </select>
                {!PRESETS_MIN.some((p) => p.value === offset) && (
                  <input
                    type="number"
                    min={5}
                    max={10080}
                    value={offset}
                    onChange={(e) => setOffset(Number(e.target.value))}
                    className={inputCls(errors.offset)}
                    placeholder="Minutos antes"
                  />
                )}
              </div>
            </Field>
          )}

          <Field label="Mensagem" error={errors.text}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Olá {{lead_name}}! Lembrete: {{appointment_title}} às {{appointment_time}}."
              className={inputCls(errors.text)}
            />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Variáveis disponíveis:{" "}
              {REMINDER_TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setText((t) => `${t}{{${v}}}`)}
                  className="mr-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground transition hover:bg-primary/15 hover:text-primary"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </p>
          </Field>

          {/* Preview */}
          <div className="rounded-xl bg-muted p-3 ring-1 ring-border">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Preview (com dados de exemplo)
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-xs text-foreground">
              {preview || (
                <span className="italic text-muted-foreground/70">
                  (vazio — a mensagem aparecerá aqui)
                </span>
              )}
            </p>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
            />
            <span className="text-sm font-bold text-foreground">
              Ativo
            </span>
            <span className="text-xs text-muted-foreground">
              (desativado: continua salvo mas não dispara)
            </span>
          </label>

          {error && (
            <div className="rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive ring-1 ring-destructive/30">
              {error}
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground transition hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !isValid}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white shadow-md shadow-primary/20 transition hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Bell size={14} />
            )}
            {submitting ? "Salvando..." : isEdit ? "Salvar" : "Criar lembrete"}
          </button>
        </footer>
      </aside>
    </div>
  );
};

const inputCls = (error?: string) =>
  `w-full rounded-xl border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
    error
      ? "border-destructive/50 focus:ring-destructive/30"
      : "border-border focus:ring-primary/30"
  }`;

const Field: React.FC<{
  label: string;
  error?: string;
  children: React.ReactNode;
}> = ({ label, error, children }) => (
  <div>
    <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-muted-foreground">
      {label}
    </label>
    {children}
    {error && (
      <p className="mt-1 text-[11px] font-semibold text-destructive">{error}</p>
    )}
  </div>
);
