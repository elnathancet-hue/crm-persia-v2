import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { listAppointments as listSharedAppointments } from "@persia/shared/agenda";
import { failureResult, getHandlerDb, successResult } from "./shared";

// PR-AGENDA-TOOLS (mai/2026): listar appointments do lead da conversa.
// Uso principal pelo LLM: antes de criar appointment novo, checar se ja
// existe um agendado pra evitar duplicata; ou listar pra responder
// "voce tem demo dia X" quando o lead pergunta.
//
// Retorno enxuto (sem `description`/`metadata` pesados) pro contexto
// do LLM ficar barato em tokens.

const listSchema = z.object({
  only_upcoming: z.boolean().nullish(),
  limit: z.number().int().min(1).max(50).nullish(),
});

export const listLeadAppointmentsHandler: NativeHandler = async (
  context,
  input,
) => {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const onlyUpcoming = parsed.data.only_upcoming ?? true;
  const limit = parsed.data.limit ?? 10;
  const fromIso = onlyUpcoming ? new Date().toISOString() : undefined;

  try {
    const rows = await listSharedAppointments(
      { db, orgId: context.organization_id },
      {
        lead_id: context.lead_id,
        kinds: ["appointment"],
        order: onlyUpcoming ? "start_at_asc" : "start_at_desc",
        from: fromIso,
        limit,
      },
    );

    // Resolve nomes dos tipos de serviço em batch (evita N queries).
    // Apenas service_ids únicos não-nulos.
    const serviceIds = [...new Set(rows.map((r) => r.service_id).filter(Boolean))] as string[];
    const serviceNameMap = new Map<string, string>();
    if (serviceIds.length > 0) {
      const { data: services } = await db
        .from("agenda_services")
        .select("id, name")
        .in("id", serviceIds)
        .eq("organization_id", context.organization_id);
      for (const s of (services ?? []) as Array<{ id: string; name: string }>) {
        serviceNameMap.set(s.id, s.name);
      }
    }

    const appointments = rows.map((row) => ({
      appointment_id: row.id,
      title: row.title,
      start_at: row.start_at,
      end_at: row.end_at,
      duration_minutes: row.duration_minutes,
      status: row.status,
      channel: row.channel,
      location: row.location,
      meeting_url: row.meeting_url,
      timezone: row.timezone,
      service_id: row.service_id ?? null,
      type_name: row.service_id ? (serviceNameMap.get(row.service_id) ?? null) : null,
    }));

    return successResult(
      {
        count: appointments.length,
        only_upcoming: onlyUpcoming,
        appointments,
      },
      [
        `listed ${appointments.length} ${onlyUpcoming ? "upcoming" : "total"} appointment(s) for lead ${context.lead_id}`,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "falha ao listar agendamentos";
    return failureResult(msg);
  }
};
