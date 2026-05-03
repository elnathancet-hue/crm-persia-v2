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
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { Textarea } from "@persia/ui/textarea";
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
  initial?: Partial<AppointmentFormValues>;
  services: readonly AgendaService[];
  initialLead?: LeadOption | null;
  fixedKind?: AppointmentKind;
  onValuesChange?: (values: AppointmentFormValues, isValid: boolean) => void;
}

export interface AppointmentFormHandle {
  /** Retorna valores se valido, ou null se invalido (mostra erros). */
  submit: () => AppointmentFormValues | null;
}

const DEFAULT_TZ = "America/Sao_Paulo";

// Sentinela pra Select shadcn — base-ui nao aceita value="" como item.
const NO_SELECTION = "__none__";

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

  const handleServiceChange = (id: string | null) => {
    if (!id || id === NO_SELECTION) {
      update("service_id", null);
      return;
    }
    update("service_id", id);
    const svc = services.find((s) => s.id === id);
    if (svc && values.start_local) {
      const newEnd = new Date(values.start_local);
      newEnd.setMinutes(newEnd.getMinutes() + svc.duration_minutes);
      update("end_local", toLocalInput(newEnd));
    }
  };

  return (
    <div className="space-y-4">
      {/* Tipo (kind) — escondido se fixedKind */}
      {!fixedKind && (
        <div className="space-y-1.5">
          <Label htmlFor="appt-kind">Tipo</Label>
          <Select
            value={values.kind}
            onValueChange={(v) => update("kind", v as AppointmentKind)}
          >
            <SelectTrigger id="appt-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="appointment">
                {APPOINTMENT_KIND_LABELS.appointment}
              </SelectItem>
              <SelectItem value="event">
                {APPOINTMENT_KIND_LABELS.event}
              </SelectItem>
              <SelectItem value="block">
                {APPOINTMENT_KIND_LABELS.block}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Titulo */}
      <div className="space-y-1.5">
        <Label htmlFor="appt-title">Título</Label>
        <Input
          id="appt-title"
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
        />
        {touched.title && errors.title && (
          <p className="text-xs text-destructive">{errors.title}</p>
        )}
      </div>

      {/* Lead (so pra appointment) */}
      {values.kind === "appointment" && (
        <div className="space-y-1.5">
          <Label>Lead (opcional)</Label>
          <LeadSearchSelect
            value={values.lead_id}
            onChange={(id) => update("lead_id", id)}
            initialSelected={initialLead}
          />
        </div>
      )}

      {/* Servico (so pra appointment) */}
      {values.kind === "appointment" && services.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="appt-service">
            Serviço{" "}
            <span className="text-muted-foreground">(preenche duração)</span>
          </Label>
          <Select
            value={values.service_id ?? NO_SELECTION}
            onValueChange={(v) => handleServiceChange(v ?? NO_SELECTION)}
          >
            <SelectTrigger id="appt-service" className="w-full">
              <SelectValue placeholder="— Sem serviço —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SELECTION}>— Sem serviço —</SelectItem>
              {services
                .filter((s) => s.is_active)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.duration_minutes} min)
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Datas */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="appt-start">Início</Label>
          <Input
            id="appt-start"
            type="datetime-local"
            value={values.start_local}
            onChange={(e) => update("start_local", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, start_local: true }))}
            aria-invalid={Boolean(touched.start_local && errors.start_local)}
          />
          {touched.start_local && errors.start_local && (
            <p className="text-xs text-destructive">{errors.start_local}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appt-end">Término</Label>
          <Input
            id="appt-end"
            type="datetime-local"
            value={values.end_local}
            onChange={(e) => update("end_local", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, end_local: true }))}
            aria-invalid={Boolean(touched.end_local && errors.end_local)}
          />
          {touched.end_local && errors.end_local && (
            <p className="text-xs text-destructive">{errors.end_local}</p>
          )}
        </div>
      </div>

      {/* Responsavel */}
      <div className="space-y-1.5">
        <Label htmlFor="appt-user">Responsável</Label>
        {users.length > 0 ? (
          <>
            <Select
              value={values.user_id || NO_SELECTION}
              onValueChange={(v) =>
                update("user_id", !v || v === NO_SELECTION ? "" : v)
              }
            >
              <SelectTrigger id="appt-user" className="w-full">
                <SelectValue placeholder="— Selecione —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION}>— Selecione —</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                    {u.email ? ` · ${u.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {touched.user_id && errors.user_id && (
              <p className="text-xs text-destructive">{errors.user_id}</p>
            )}
          </>
        ) : (
          <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Você (responsável padrão).
          </p>
        )}
      </div>

      {/* Canal + local (so pra appointment/event, nao pra block) */}
      {values.kind !== "block" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="appt-channel">Canal</Label>
            <Select
              value={values.channel || NO_SELECTION}
              onValueChange={(v) =>
                update(
                  "channel",
                  !v || v === NO_SELECTION ? "" : (v as AppointmentChannel),
                )
              }
            >
              <SelectTrigger id="appt-channel" className="w-full">
                <SelectValue placeholder="— Selecione —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION}>— Selecione —</SelectItem>
                {APPOINTMENT_CHANNELS.map((ch) => (
                  <SelectItem key={ch} value={ch}>
                    {APPOINTMENT_CHANNEL_LABELS[ch]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {values.channel !== "online" && (
            <div className="space-y-1.5">
              <Label htmlFor="appt-location">Local</Label>
              <Input
                id="appt-location"
                type="text"
                value={values.location}
                onChange={(e) => update("location", e.target.value)}
                placeholder="Endereço, sala, etc."
              />
            </div>
          )}

          {values.channel === "online" && (
            <div className="space-y-1.5">
              <Label htmlFor="appt-meeting-url">Link da reunião</Label>
              <Input
                id="appt-meeting-url"
                type="url"
                value={values.meeting_url}
                onChange={(e) => update("meeting_url", e.target.value)}
                onBlur={() =>
                  setTouched((t) => ({ ...t, meeting_url: true }))
                }
                aria-invalid={Boolean(
                  touched.meeting_url && errors.meeting_url,
                )}
                placeholder="https://meet.google.com/..."
              />
              {touched.meeting_url && errors.meeting_url && (
                <p className="text-xs text-destructive">
                  {errors.meeting_url}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Descricao */}
      <div className="space-y-1.5">
        <Label htmlFor="appt-description">Notas (opcional)</Label>
        <Textarea
          id="appt-description"
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
          rows={3}
          placeholder="Adicione contexto, lembrete ou observação..."
        />
      </div>
    </div>
  );
});
