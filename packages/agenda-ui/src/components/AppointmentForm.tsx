"use client";

import * as React from "react";
import {
  type AgendaService,
  type AppointmentChannel,
  type AppointmentKind,
  APPOINTMENT_CHANNELS,
  APPOINTMENT_CHANNEL_LABELS,
  APPOINTMENT_KIND_LABELS,
} from "@persia/shared/agenda";
import { useAgendaCallbacks } from "../context";
import type { LeadOption } from "../actions";
import { LeadSearchSelect } from "./LeadSearchSelect";

export interface AppointmentFormValues {
  kind: AppointmentKind;
  title: string;
  description: string;
  /** ISO local sem timezone (ex: "2026-05-04T09:00") — convertido pra UTC no submit. */
  start_local: string;
  end_local: string;
  timezone: string;
  user_id: string;
  service_id: string | null;
  lead_id: string | null;
  channel: AppointmentChannel | "";
  location: string;
  meeting_url: string;
}

interface AppointmentFormProps {
  /** Estado inicial. Quando undefined = modo "criar" com defaults. */
  initial?: Partial<AppointmentFormValues>;
  /** Servicos disponiveis (carregados pela parent). */
  services: readonly AgendaService[];
  /** Lead pre-selecionado pra mostrar nome (criacao a partir de /leads/[id]). */
  initialLead?: LeadOption | null;
  /** Esconde o seletor de kind (ex: na criacao especifica de evento ou block). */
  fixedKind?: AppointmentKind;
  /** Mostra so os campos compativeis com o tipo (event/block escondem lead). */
  onValuesChange?: (values: AppointmentFormValues, isValid: boolean) => void;
}

export interface AppointmentFormHandle {
  /** Retorna valores se valido, ou null se invalido (mostra erros). */
  submit: () => AppointmentFormValues | null;
}

const DEFAULT_TZ = "America/Sao_Paulo";

function defaultStartLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}

function defaultEndLocal(start: string): string {
  const d = new Date(start);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const AppointmentForm = React.forwardRef<
  AppointmentFormHandle,
  AppointmentFormProps
>(function AppointmentForm(
  { initial = {}, services, initialLead = null, fixedKind, onValuesChange },
  ref,
) {
  const callbacks = useAgendaCallbacks();
  const users = callbacks.agendaUsers ?? [];
  const currentUserId = callbacks.currentUserId ?? "";

  const startInit = initial.start_local ?? defaultStartLocal();
  const endInit = initial.end_local ?? defaultEndLocal(startInit);

  const [values, setValues] = React.useState<AppointmentFormValues>({
    kind: fixedKind ?? initial.kind ?? "appointment",
    title: initial.title ?? "",
    description: initial.description ?? "",
    start_local: startInit,
    end_local: endInit,
    timezone: initial.timezone ?? DEFAULT_TZ,
    user_id: initial.user_id ?? currentUserId,
    service_id: initial.service_id ?? null,
    lead_id: initial.lead_id ?? null,
    channel: (initial.channel as AppointmentChannel | undefined) ?? "",
    location: initial.location ?? "",
    meeting_url: initial.meeting_url ?? "",
  });
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});

  const errors = React.useMemo(() => {
    const e: Partial<Record<keyof AppointmentFormValues, string>> = {};
    if (values.title.trim().length === 0) {
      e.title = "Título obrigatório";
    } else if (values.title.length > 200) {
      e.title = "Máximo 200 caracteres";
    }
    if (!values.start_local) e.start_local = "Início obrigatório";
    if (!values.end_local) e.end_local = "Término obrigatório";
    if (values.start_local && values.end_local) {
      if (
        new Date(values.end_local).getTime() <=
        new Date(values.start_local).getTime()
      ) {
        e.end_local = "Término deve ser após o início";
      }
    }
    if (!values.user_id) e.user_id = "Responsável obrigatório";
    if (
      values.kind === "appointment" &&
      values.channel === "online" &&
      values.meeting_url &&
      !/^https?:\/\//i.test(values.meeting_url)
    ) {
      e.meeting_url = "URL inválida (deve começar com http:// ou https://)";
    }
    return e;
  }, [values]);

  const isValid = Object.keys(errors).length === 0;

  React.useEffect(() => {
    onValuesChange?.(values, isValid);
  }, [values, isValid, onValuesChange]);

  React.useImperativeHandle(
    ref,
    () => ({
      submit: () => {
        // Marca tudo como touched pra mostrar erros
        setTouched({
          title: true,
          start_local: true,
          end_local: true,
          user_id: true,
          meeting_url: true,
        });
        return isValid ? values : null;
      },
    }),
    [isValid, values],
  );

  const update = <K extends keyof AppointmentFormValues>(
    key: K,
    val: AppointmentFormValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: val }));

  const handleServiceChange = (id: string) => {
    if (id === "") {
      update("service_id", null);
      return;
    }
    update("service_id", id);
    // Auto-preenche duracao baseado no servico
    const svc = services.find((s) => s.id === id);
    if (svc && values.start_local) {
      const newEnd = new Date(values.start_local);
      newEnd.setMinutes(newEnd.getMinutes() + svc.duration_minutes);
      update("end_local", toLocalInput(newEnd));
    }
  };

  const fieldErrorClass = (field: keyof AppointmentFormValues) =>
    touched[field] && errors[field]
      ? "border-destructive/50 focus:ring-destructive/30"
      : "border-border focus:ring-primary/30";

  return (
    <div className="space-y-5">
      {/* Tipo (kind) — escondido se fixedKind */}
      {!fixedKind && (
        <Field label="Tipo">
          <select
            value={values.kind}
            onChange={(e) => update("kind", e.target.value as AppointmentKind)}
            className={`w-full rounded-xl border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrorClass("kind")}`}
          >
            <option value="appointment">{APPOINTMENT_KIND_LABELS.appointment}</option>
            <option value="event">{APPOINTMENT_KIND_LABELS.event}</option>
            <option value="block">{APPOINTMENT_KIND_LABELS.block}</option>
          </select>
        </Field>
      )}

      {/* Titulo */}
      <Field label="Título" error={touched.title ? errors.title : undefined}>
        <input
          type="text"
          value={values.title}
          onChange={(e) => update("title", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, title: true }))}
          aria-invalid={Boolean(touched.title && errors.title)}
          placeholder={
            values.kind === "block"
              ? "Ex: Almoço, Folga"
              : values.kind === "event"
                ? "Ex: Reunião de equipe"
                : "Ex: Consulta inicial — Carlos"
          }
          className={`w-full rounded-xl border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrorClass("title")}`}
        />
      </Field>

      {/* Lead (so pra appointment) */}
      {values.kind === "appointment" && (
        <Field label="Lead (opcional)">
          <LeadSearchSelect
            value={values.lead_id}
            onChange={(id) => update("lead_id", id)}
            initialSelected={initialLead}
          />
        </Field>
      )}

      {/* Servico (so pra appointment) */}
      {values.kind === "appointment" && services.length > 0 && (
        <Field label="Serviço (opcional — preenche duração)">
          <select
            value={values.service_id ?? ""}
            onChange={(e) => handleServiceChange(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">— Sem serviço —</option>
            {services
              .filter((s) => s.is_active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.duration_minutes} min)
                </option>
              ))}
          </select>
        </Field>
      )}

      {/* Datas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Início" error={touched.start_local ? errors.start_local : undefined}>
          <input
            type="datetime-local"
            value={values.start_local}
            onChange={(e) => update("start_local", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, start_local: true }))}
            aria-invalid={Boolean(touched.start_local && errors.start_local)}
            className={`w-full rounded-xl border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrorClass("start_local")}`}
          />
        </Field>
        <Field label="Término" error={touched.end_local ? errors.end_local : undefined}>
          <input
            type="datetime-local"
            value={values.end_local}
            onChange={(e) => update("end_local", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, end_local: true }))}
            aria-invalid={Boolean(touched.end_local && errors.end_local)}
            className={`w-full rounded-xl border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrorClass("end_local")}`}
          />
        </Field>
      </div>

      {/* Responsavel */}
      <Field label="Responsável" error={touched.user_id ? errors.user_id : undefined}>
        {users.length > 0 ? (
          <select
            value={values.user_id}
            onChange={(e) => update("user_id", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, user_id: true }))}
            aria-invalid={Boolean(touched.user_id && errors.user_id)}
            className={`w-full rounded-xl border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrorClass("user_id")}`}
          >
            <option value="">— Selecione —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.email ? ` · ${u.email}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            Você (responsável padrão).
          </p>
        )}
      </Field>

      {/* Canal + local (so pra appointment/event, nao pra block) */}
      {values.kind !== "block" && (
        <>
          <Field label="Canal">
            <select
              value={values.channel}
              onChange={(e) => update("channel", e.target.value as AppointmentChannel | "")}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">— Selecione —</option>
              {APPOINTMENT_CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {APPOINTMENT_CHANNEL_LABELS[ch]}
                </option>
              ))}
            </select>
          </Field>

          {values.channel !== "online" && (
            <Field label="Local">
              <input
                type="text"
                value={values.location}
                onChange={(e) => update("location", e.target.value)}
                placeholder="Endereço, sala, etc."
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Field>
          )}

          {values.channel === "online" && (
            <Field label="Link da reunião" error={touched.meeting_url ? errors.meeting_url : undefined}>
              <input
                type="url"
                value={values.meeting_url}
                onChange={(e) => update("meeting_url", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, meeting_url: true }))}
                aria-invalid={Boolean(touched.meeting_url && errors.meeting_url)}
                placeholder="https://meet.google.com/..."
                className={`w-full rounded-xl border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrorClass("meeting_url")}`}
              />
            </Field>
          )}
        </>
      )}

      {/* Descricao */}
      <Field label="Notas (opcional)">
        <textarea
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Adicione contexto, lembrete ou observação..."
        />
      </Field>
    </div>
  );
});

interface FieldProps {
  label: string;
  error?: string;
  children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ label, error, children }) => (
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
