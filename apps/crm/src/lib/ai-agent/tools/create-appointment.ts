import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { createAppointment as createAppointmentShared } from "@persia/shared/agenda";
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
  duration_minutes: z.number().int().min(15).max(480),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  channel: z
    .enum(["whatsapp", "phone", "online", "in_person"])
    .optional(),
  location: z.string().trim().max(500).optional(),
  meeting_url: z.string().trim().max(500).optional(),
});

interface LeadRow {
  id: string;
  assigned_to: string | null;
  timezone: string | null;
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

  // 1. Resolve responsavel do lead. Sem responsavel, falha (forca
  //    operador a atribuir antes — appointment orfao confunde quem
  //    fica olhando a agenda).
  const { data: leadRow, error: leadError } = await db
    .from("leads")
    .select("id, assigned_to, timezone")
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

  const endMs = startMs + parsed.data.duration_minutes * 60_000;
  const end_at = new Date(endMs).toISOString();
  const timezone = lead.timezone || "America/Sao_Paulo";

  if (context.dry_run) {
    return successResult(
      {
        lead_id: lead.id,
        user_id: lead.assigned_to,
        start_at: parsed.data.start_at,
        end_at,
        duration_minutes: parsed.data.duration_minutes,
        title: parsed.data.title,
        noop: false,
        dry_run: true,
      },
      [
        `would create appointment "${parsed.data.title}" at ${parsed.data.start_at} (${parsed.data.duration_minutes} min) for lead ${lead.id}`,
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
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        lead_id: lead.id,
        user_id: lead.assigned_to,
        service_id: null,
        booking_page_id: null,
        start_at: parsed.data.start_at,
        end_at,
        duration_minutes: parsed.data.duration_minutes,
        timezone,
        status: "awaiting_confirmation",
        channel: parsed.data.channel ?? null,
        location: parsed.data.location ?? null,
        meeting_url: parsed.data.meeting_url ?? null,
      },
    );

    // PR-AGENT-INTEGRATION-1: log no historico do lead.
    await insertLeadActivity({
      db,
      organizationId: context.organization_id,
      leadId: lead.id,
      type: "appointment_created",
      description: `IA agendou "${created.title}" para ${created.start_at}`,
      metadata: {
        appointment_id: created.id,
        start_at: created.start_at,
        end_at: created.end_at,
        timezone: created.timezone,
        status: created.status,
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
      },
      [
        `created appointment "${created.title}" at ${created.start_at} for lead ${lead.id}`,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "falha ao criar agendamento";
    return failureResult(msg);
  }
};
