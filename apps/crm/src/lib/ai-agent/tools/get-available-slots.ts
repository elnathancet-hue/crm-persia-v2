import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import {
  getDefaultAvailabilityRule,
  getAvailableSlots,
  listAppointments,
} from "@persia/shared/agenda";
import { failureResult, getHandlerDb, successResult } from "./shared";

// Tool get_available_slots: a IA consulta horarios livres do profissional
// responsavel antes de propor opcoes ao lead. Elimina o ciclo cego
// (tentar criar → falhar → pedir outra data → tentar → falhar...).
//
// Fluxo tipico:
//   1. Lead diz "quero marcar uma consulta"
//   2. IA chama get_available_slots para saber quais datas/horas estao livres
//   3. IA apresenta as opcoes ao lead: "Tenho segunda 10h e 14h, terça 9h"
//   4. Lead escolhe → IA chama create_appointment com a data confirmada
//
// Resolucao de profissional (mesma chain de create_appointment):
//   type.default_user_id → lead.assigned_to → primeiro admin/owner da org

const schema = z.object({
  /** Data de inicio da busca, formato YYYY-MM-DD.
   *  Default: hoje no timezone da regra de disponibilidade. */
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "start_date deve ser YYYY-MM-DD")
    .nullish(),
  /** Quantos dias à frente buscar. Default 7, max 14. */
  days_ahead: z.number().int().min(1).max(14).nullish(),
  /** Slug do tipo de agendamento — herda duracao e default_user_id do tipo. */
  type_slug: z.string().trim().min(1).max(80).nullish(),
  /** Override de duracao quando type_slug nao e passado. Default 60min. */
  duration_minutes: z.number().int().min(15).max(480).nullish(),
});

interface ServiceRow {
  duration_minutes: number;
  default_user_id: string | null;
}

interface LeadRow {
  assigned_to: string | null;
}

interface MemberRow {
  user_id: string;
}

export const getAvailableSlotsHandler: NativeHandler = async (context, input) => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const daysAhead = parsed.data.days_ahead ?? 7;

  // 1. Resolve tipo de servico: herda duracao e default_user_id
  let resolvedDuration = parsed.data.duration_minutes ?? 60;
  let serviceDefaultUserId: string | null = null;

  if (parsed.data.type_slug) {
    const { data: service } = await db
      .from("agenda_services")
      .select("duration_minutes, default_user_id")
      .eq("organization_id", context.organization_id)
      .ilike("slug", parsed.data.type_slug)
      .eq("is_active", true)
      .maybeSingle();
    if (service) {
      const s = service as ServiceRow;
      resolvedDuration = s.duration_minutes;
      serviceDefaultUserId = s.default_user_id;
    }
  }

  // 2. Resolve profissional responsavel (mesma chain de create_appointment)
  let userId: string | null = serviceDefaultUserId;

  if (!userId) {
    const { data: lead } = await db
      .from("leads")
      .select("assigned_to")
      .eq("organization_id", context.organization_id)
      .eq("id", context.lead_id)
      .maybeSingle();
    userId = (lead as LeadRow | null)?.assigned_to ?? null;
  }

  if (!userId) {
    const { data: adminMember } = await db
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", context.organization_id)
      .in("role", ["owner", "admin"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    userId = (adminMember as MemberRow | null)?.user_id ?? null;
  }

  if (!userId) {
    return failureResult("nenhum profissional encontrado para consultar disponibilidade", {
      hint: "atribua um responsavel ao lead ou configure default_user_id no tipo de agendamento",
    });
  }

  // 3. Busca regra de disponibilidade do profissional
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agendaCtx = { db: db as any, orgId: context.organization_id };
  const rule = await getDefaultAvailabilityRule(agendaCtx, userId);

  if (!rule) {
    // Sem regra = sem restricao de horario. Informa a IA mas nao retorna slots
    // (qualquer horario futuro e valido — deixa a IA negociar com o lead).
    return successResult(
      {
        user_id: userId,
        has_availability_rule: false,
        duration_minutes: resolvedDuration,
        note: "profissional sem regra de disponibilidade — qualquer horario futuro e aceito",
        available_days: [],
      },
      ["no availability rule configured — any future time is accepted"],
    );
  }

  // 4. Define janela de busca a partir de start_date
  // Usa o timezone da regra para calcular "hoje" corretamente
  const todayInTz = new Date().toLocaleDateString("sv-SE", {
    timeZone: rule.timezone,
  });
  const startDate = parsed.data.start_date ?? todayInTz;

  // Valida que start_date nao e no passado (tolerancia de 1 dia)
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const nowMs = Date.now();
  if (startMs < nowMs - 24 * 60 * 60_000) {
    return failureResult("start_date nao pode ser no passado");
  }

  // 5. Busca agendamentos existentes do profissional na janela (para conflict check)
  const windowEndMs = startMs + (daysAhead + 1) * 24 * 60 * 60_000;
  let existingAppointments: Awaited<ReturnType<typeof listAppointments>> = [];
  try {
    existingAppointments = await listAppointments(agendaCtx, {
      user_id: userId,
      from: new Date(startMs).toISOString(),
      to: new Date(windowEndMs).toISOString(),
      kinds: ["appointment", "block"],
      statuses: ["awaiting_confirmation", "confirmed", "rescheduled"],
    });
  } catch {
    // Best-effort: se falhar, continua sem conflict check (pode mostrar slots
    // que na verdade estao ocupados, mas e melhor que falhar completamente)
  }

  // 6. Gera slots livres por dia
  const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  type DayResult = { date: string; day_of_week: string; slots: string[] };
  const availableDays: DayResult[] = [];

  for (let i = 0; i < daysAhead; i++) {
    // Calcula a data do dia i a partir de startDate no timezone da regra
    const dayMs = startMs + i * 24 * 60 * 60_000;
    const dateStr = new Date(dayMs).toLocaleDateString("sv-SE", {
      timeZone: rule.timezone,
    });

    const daySlots = getAvailableSlots({
      date: dateStr,
      rule,
      duration_minutes: resolvedDuration,
      buffer_minutes: 0,
      existing: existingAppointments,
    });

    if (daySlots.length > 0) {
      const dayOfWeek = new Date(dayMs).toLocaleDateString("pt-BR", {
        timeZone: rule.timezone,
        weekday: "long",
      });
      availableDays.push({
        date: dateStr,
        day_of_week: dayOfWeek,
        // Limita 6 slots por dia para nao inflar o contexto do LLM
        slots: daySlots.slice(0, 6).map((s) => s.display_time),
      });
    }

    // Para quando ja encontrou 5 dias com slots (mais que suficiente pra oferecer)
    if (availableDays.length >= 5) break;
  }

  if (availableDays.length === 0) {
    return successResult(
      {
        user_id: userId,
        has_availability_rule: true,
        duration_minutes: resolvedDuration,
        timezone: rule.timezone,
        available_days: [],
        note: `nenhum horario livre nos proximos ${daysAhead} dias uteis — tente dias_ahead maior ou outra semana`,
      },
      [`no available slots in the next ${daysAhead} days`],
    );
  }

  return successResult(
    {
      user_id: userId,
      has_availability_rule: true,
      duration_minutes: resolvedDuration,
      timezone: rule.timezone,
      available_days: availableDays,
    },
    [
      `found ${availableDays.length} days with available ${resolvedDuration}min slots starting ${startDate}`,
    ],
  );
};
