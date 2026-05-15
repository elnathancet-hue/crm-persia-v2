"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import type {
  AvailabilityDay,
  AvailabilityRule,
  DayOfWeek,
} from "@persia/shared/agenda";
import { AvailabilityDayRow } from "./AvailabilityDayRow";

interface WeeklyAvailabilityEditorProps {
  rule: AvailabilityRule;
  onSave: (patch: {
    name?: string;
    timezone?: string;
    default_duration_minutes?: number;
    days?: AvailabilityDay[];
    is_default?: boolean;
  }) => Promise<void>;
}

const DEFAULT_DAYS: AvailabilityDay[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  day_of_week: d as DayOfWeek,
  enabled: d >= 1 && d <= 5,
  intervals:
    d >= 1 && d <= 5 ? [{ start: "09:00", end: "18:00" }] : [],
}));

const COMMON_TIMEZONES = [
  "America/Sao_Paulo",
  "America/Belem",
  "America/Manaus",
  "America/Rio_Branco",
  "America/Noronha",
  "UTC",
];

export const WeeklyAvailabilityEditor: React.FC<
  WeeklyAvailabilityEditorProps
> = ({ rule, onSave }) => {
  // Garante 7 dias mesmo se days do DB veio vazio ou parcial
  const initialDays = React.useMemo(() => {
    const map = new Map<number, AvailabilityDay>();
    for (const d of rule.days ?? []) {
      map.set(d.day_of_week, d);
    }
    return DEFAULT_DAYS.map((d) => map.get(d.day_of_week) ?? d);
  }, [rule.days]);

  const [days, setDays] = React.useState<AvailabilityDay[]>(initialDays);
  const [name, setName] = React.useState(rule.name);
  const [timezone, setTimezone] = React.useState(rule.timezone);
  const [defaultDuration, setDefaultDuration] = React.useState(
    rule.default_duration_minutes,
  );
  const [isDefault, setIsDefault] = React.useState(rule.is_default);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  const handleDayChange = (idx: number, day: AvailabilityDay) => {
    setDays((prev) => prev.map((d, i) => (i === idx ? day : d)));
  };

  // Detecta erros simples (intervalo invertido)
  const dayErrors = React.useMemo(() => {
    const errs: number[] = [];
    days.forEach((d, idx) => {
      if (!d.enabled) return;
      for (const iv of d.intervals) {
        if (iv.start >= iv.end) {
          errs.push(idx);
          break;
        }
      }
    });
    return errs;
  }, [days]);

  const handleSave = async () => {
    if (dayErrors.length > 0) {
      setError(
        `Algumas janelas têm horário inválido (início ≥ término) em: ${dayErrors.length} dia(s)`,
      );
      return;
    }
    if (name.trim().length === 0) {
      setError("Nome obrigatório");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        timezone,
        default_duration_minutes: defaultDuration,
        days,
        is_default: isDefault,
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Nome">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </Field>
        <Field label="Fuso horário">
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duração padrão (min)">
          <input
            type="number"
            min={5}
            max={1440}
            value={defaultDuration}
            onChange={(e) =>
              setDefaultDuration(Number(e.target.value))
            }
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </Field>
      </div>

      <label className="inline-flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
        />
        <span className="text-sm font-bold text-foreground">
          Marcar como regra padrão
        </span>
        <span className="text-xs text-muted-foreground">
          (a regra padrão é usada pra calcular slots no booking público)
        </span>
      </label>

      <section>
        <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Janela semanal
        </h3>
        <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
          {days.map((d, idx) => (
            <AvailabilityDayRow
              key={d.day_of_week}
              day={d}
              onChange={(newDay) => handleDayChange(idx, newDay)}
            />
          ))}
        </div>
      </section>

      {error && (
        <p className="rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive ring-1 ring-destructive/30">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="text-xs font-semibold text-success">
            Salvo
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white shadow-md shadow-primary/20 transition hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
          {saving ? "Salvando..." : "Salvar disponibilidade"}
        </button>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-muted-foreground">
      {label}
    </label>
    {children}
  </div>
);
