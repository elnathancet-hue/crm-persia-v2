import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { createAppointment as createAppointmentShared } from "@persia/shared/agenda";
import { errorMessage, logError } from "@/lib/observability";
import {
  buildEventFromAppointment,
  createGoogleEvent,
  loadGoogleConnectionForOrg,
} from "@/lib/google-calendar/events";
import {
  failureResult,
  getHandlerDb,
  insertLeadActivity,
  successResult,
} from "./shared";

// PR-AGENDA-TOOLS (mai/2026): AI Agent cria appointment do lead da
// conversa diretamente pelo chat WhatsApp. Sem isso, o LLM tinha que
// transferir pro humano agendar — quebrava UX conversacional.
//
// PR-AI-AGENT-APPOINTMENT-TYPES (mai/2026): agora aceita `type_slug`
// (recomendado) que herda title/duration/channel/location/meeting_url
// do `agenda_services` cadastrado. Cliente cadastra os tipos uma vez
// (UI em /automations/appointments) e a IA usa nome amigavel em vez de
// inventar titulo/duracao a cada conversa. Os campos antigos continuam
// aceitos pra retrocompat e como override pontual.
//
// Decisoes:
//   - user_id = lead.assigned_to (responsavel do lead). Sem responsavel,
//     falha com mensagem clara. Forca setup correto em vez de criar
//     appointment orfao.
//   - status = 'awaiting_confirmation' por default (lead confirmou
//     verbalmente no chat, mas precisa de confirmacao formal).
//   - kind = 'appointment' sempre (event/block sao internos, AI nao
//     usa).
//   - Conflict check ON via shared (rejeita slots sobrepostos).
//   - duration_minutes calculado pra end_at no handler.

const createSchema = z.object({
  start_at: z.string().datetime({ offset: true }),
  // PR-AI-AGENT-APPOINTMENT-TYPES: novo caminho recomendado — IA passa
  // slug do tipo, runtime resolve duracao/canal/local/titulo.
  type_slug: z.string().trim().min(1).max(80).nullish(),
  // Campos antigos — agora opcionais. Quando passados junto com
  // type_slug, fazem override do default. Quando passados sozinhos
  // (sem type_slug), mantem comportamento legado.
  duration_minutes: z.number().int().min(15).max(480).nullish(),
  title: z.string().trim().min(1).max(200).nullish(),
  description: z.string().trim().max(2000).nullish(),
  channel: z
    .enum(["whatsapp", "phone", "online", "in_person"])
    .nullish(),
  location: z.string().trim().max(500).nullish(),
  meeting_url: z.string().trim().max(500).nullish(),
});

interface AppointmentTypeRow {
  id: string;
  name: string;
  duration_minutes: number;
  default_channel: "whatsapp" | "phone" | "online" | "in_person" | null;
  default_location: string | null;
  default_meeting_url: string | null;
}

interface LeadRow {
  id: string;
  assigned_to: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export const createAppointmentHandler: NativeHandler = async (context, input) => {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const startMs = Date.parse(parsed.data.start_at);
  if (Number.isNaN(startMs)) {
    return failureResult("start_at invalido");
  }
  if (startMs <= Date.now()) {
    return failureResult("start_at deve ser no futuro");
  }

  // PR-AI-AGENT-APPOINTMENT-TYPES: resolve o tipo (se passado) e
  // combina com overrides explicitos. Validacao final: precisa
  // resolver title + duration_minutes — vindo do tipo, do input, ou
  // ambos com input ganhando.
  let appointmentType: AppointmentTypeRow | null = null;
  if (parsed.data.type_slug) {
    const { data, error } = await db
      .from("agenda_services")
      .select(
        "id, name, duration_minutes, default_channel, default_location, default_meeting_url",
      )
      .eq("organization_id", context.organization_id)
      .ilike("slug", parsed.data.type_slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) return failureResult(error.message);
    if (!data) {
      return failureResult(`tipo de agendamento "${parsed.data.type_slug}" nao encontrado`, {
        slug: parsed.data.type_slug,
        hint: "use um dos slugs listados em TIPOS DE AGENDAMENTO DISPONÍVEIS no prompt",
      });
    }
    appointmentType = data as AppointmentTypeRow;
  }

  // Resolve campos finais: override do input ganha do tipo. Pelo menos
  // title + duration_minutes devem chegar resolvidos no final.
  const resolvedTitle = parsed.data.title ?? appointmentType?.name ?? null;
  const resolvedDuration =
    parsed.data.duration_minutes ?? appointmentType?.duration_minutes ?? null;
  const resolvedChannel =
    parsed.data.channel ?? appointmentType?.default_channel ?? null;
  const resolvedLocation =
    parsed.data.location ?? appointmentType?.default_location ?? null;
  const resolvedMeetingUrl =
    parsed.data.meeting_url ?? appointmentType?.default_meeting_url ?? null;

  if (!resolvedTitle) {
    return failureResult(
      "informe type_slug (recomendado) ou title — sem isso a IA estaria inventando o titulo",
    );
  }
  if (!resolvedDuration) {
    return failureResult(
      "informe type_slug (recomendado) ou duration_minutes",
    );
  }

  // 1. Resolve responsavel do lead. Sem responsavel, falha (forca
  //    operador a atribuir antes — appointment orfao confunde quem
  //    fica olhando a agenda).
  const { data: leadRow, error: leadError } = await db
    .from("leads")
    .select("id, assigned_to, name, email, phone")
    .eq("organization_id", context.organization_id)
    .eq("id", context.lead_id)
    .maybeSingle();

  if (leadError) return failureResult(leadError.message);
  if (!leadRow) return failureResult("lead nao encontrado");

  const lead = leadRow as LeadRow;
  if (!lead.assigned_to) {
    return failureResult(
      "lead nao tem responsavel atribuido — defina um responsavel antes de agendar",
    );
  }

  const endMs = startMs + resolvedDuration * 60_000;
  const end_at = new Date(endMs).toISOString();
  // PR-FIX-LEADS-TIMEZONE (mai/2026): tabela `leads` NAO tem coluna
  // `timezone` (descoberto em teste live — handler tentava SELECT
  // timezone e falhava 4x antes de IA cair em stop_agent). Default
  // America/Sao_Paulo direto (timezone real do lead pode entrar em
  // migration futura se necessario).
  const timezone = "America/Sao_Paulo";

  if (context.dry_run) {
    return successResult(
      {
        lead_id: lead.id,
        user_id: lead.assigned_to,
        start_at: parsed.data.start_at,
        end_at,
        duration_minutes: resolvedDuration,
        title: resolvedTitle,
        type_slug: parsed.data.type_slug ?? null,
        noop: false,
        dry_run: true,
      },
      [
        `would create appointment "${resolvedTitle}" at ${parsed.data.start_at} (${resolvedDuration} min) for lead ${lead.id}`,
      ],
    );
  }

  // 2. Cria via shared mutation. Shared faz conflict check + history.
  //    Pode lancar AppointmentConflictError se slot ocupado.
  try {
    const created = await createAppointmentShared(
      {
        db,
        orgId: context.organization_id,
        userId: null,
        performedByRole: "agent",
      },
      {
        kind: "appointment",
        title: resolvedTitle,
        description: parsed.data.description ?? null,
        lead_id: lead.id,
        user_id: lead.assigned_to,
        // Linka ao agenda_services quando veio do tipo — pra
        // estatisticas/filtros de agenda virem corretos.
        service_id: appointmentType?.id ?? null,
        booking_page_id: null,
        start_at: parsed.data.start_at,
        end_at,
        duration_minutes: resolvedDuration,
        timezone,
        status: "awaiting_confirmation",
        channel: resolvedChannel,
        location: resolvedLocation,
        meeting_url: resolvedMeetingUrl,
      },
    );

    // PR-FLOW-PIVOT PR 14b (mai/2026): se org tem Google Calendar
    // conectado + default_calendar_id setado, espelha o appointment lá.
    // Best-effort: falha de sync NÃO desfaz o appointment interno (que
    // continua sendo source of truth).
    let googleEventId: string | null = null;
    let googleEventLink: string | null = null;
    try {
      const conn = await loadGoogleConnectionForOrg(db, context.organization_id);
      if (conn) {
        const event = buildEventFromAppointment({
          title: created.title,
          description: parsed.data.description ?? null,
          location: resolvedLocation,
          meetingUrl: resolvedMeetingUrl,
          startAt: created.start_at,
          endAt: created.end_at,
          timezone: created.timezone,
          leadEmail: lead.email,
          leadName: lead.name,
          leadPhone: lead.phone,
        });
        const result = await createGoogleEvent(
          db,
          conn,
          conn.default_calendar_id,
          event,
        );
        googleEventId = result.id;
        googleEventLink = result.htmlLink ?? null;
        // Persiste o event_id no appointment pra cancel/reschedule
        // futuros poderem encontrar.
        await db
          .from("appointments")
          .update({ google_event_id: googleEventId })
          .eq("organization_id", context.organization_id)
          .eq("id", created.id);
      }
    } catch (gcalErr) {
      logError("create_appointment_gcal_sync_failed", {
        organization_id: context.organization_id,
        appointment_id: created.id,
        error: errorMessage(gcalErr),
      });
      // Continua — appointment interno permanece. Cliente pode resyncar
      // manualmente em PR futuro (botão "Sincronizar com Google").
    }

    // PR-AGENT-INTEGRATION-1: log no historico do lead.
    await insertLeadActivity({
      db,
      organizationId: context.organization_id,
      leadId: lead.id,
      type: "appointment_created",
      description: `IA agendou "${created.title}" para ${created.start_at}${
        googleEventId ? " (sincronizado com Google Calendar)" : ""
      }`,
      metadata: {
        appointment_id: created.id,
        start_at: created.start_at,
        end_at: created.end_at,
        timezone: created.timezone,
        status: created.status,
        google_event_id: googleEventId,
      },
    });

    return successResult(
      {
        appointment_id: created.id,
        lead_id: lead.id,
        user_id: lead.assigned_to,
        start_at: created.start_at,
        end_at: created.end_at,
        duration_minutes: created.duration_minutes,
        title: created.title,
        status: created.status,
        timezone: created.timezone,
        google_event_id: googleEventId,
        google_event_link: googleEventLink,
      },
      [
        `created appointment "${created.title}" at ${created.start_at} for lead ${lead.id}`,
        ...(googleEventId ? ["synced to Google Calendar"] : []),
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "falha ao criar agendamento";
    return failureResult(msg);
  }
};
