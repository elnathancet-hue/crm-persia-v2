import OpenAI from "openai";
import type {
  AgentConfig,
  AgentConversation,
  NativeHandlerContext,
  NativeHandlerResult,
} from "@persia/shared/ai-agent";
import type { AvailabilityRule } from "@persia/shared/agenda";
import { getAvailableSlots, listAppointments } from "@persia/shared/agenda";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import { asAgentDb, nowIso, type AgentDb } from "../db";

export interface HandlerContextWithDb extends NativeHandlerContext {
  db?: AgentDb;
  provider?: WhatsAppProvider | null;
  config?: AgentConfig;
  agentConversation?: AgentConversation;
  openaiClient?: OpenAI | null;
  stepOrderIndex?: number;
}

export function getHandlerDb(context: NativeHandlerContext): AgentDb | null {
  const candidate = (context as HandlerContextWithDb).db;
  if (!candidate || typeof candidate !== "object") return null;
  return asAgentDb(candidate);
}

export function getHandlerProvider(context: NativeHandlerContext): WhatsAppProvider | null {
  return (context as HandlerContextWithDb).provider ?? null;
}

export function getHandlerConfig(context: NativeHandlerContext): AgentConfig | null {
  return (context as HandlerContextWithDb).config ?? null;
}

export function getHandlerConversation(context: NativeHandlerContext): AgentConversation | null {
  return (context as HandlerContextWithDb).agentConversation ?? null;
}

export function getHandlerOpenAIClient(context: NativeHandlerContext): OpenAI | null {
  return (context as HandlerContextWithDb).openaiClient ?? null;
}

export function getHandlerStepOrderIndex(context: NativeHandlerContext): number | null {
  const value = (context as HandlerContextWithDb).stepOrderIndex;
  return typeof value === "number" ? value : null;
}

export function successResult(
  output: Record<string, unknown>,
  sideEffects?: string[],
): NativeHandlerResult {
  return {
    success: true,
    output,
    side_effects: sideEffects ?? [],
  };
}

export function failureResult(error: string, output: Record<string, unknown> = {}): NativeHandlerResult {
  return {
    success: false,
    output,
    error,
  };
}

export function trimReason(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 500)
    : fallback;
}

const AVAILABILITY_DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Constrói o payload de erro quando um horário está fora da disponibilidade.
 * Inclui os horários configurados (texto) e os próximos 5 slots livres
 * concretos para a IA oferecer ao lead como alternativas.
 *
 * Best-effort: se a query de agendamentos existentes falhar, continua
 * sem conflict check (pode retornar slots que já estão ocupados).
 */
export async function buildAvailabilityError(
  db: AgentDb,
  orgId: string,
  userId: string,
  rule: AvailabilityRule,
  durationMinutes: number,
): Promise<{ available_hours: string; timezone: string; suggested_slots: string[] }> {
  const available = rule.days
    .filter((d) => d.enabled && d.intervals.length > 0)
    .map(
      (d) =>
        `${AVAILABILITY_DAY_NAMES[d.day_of_week]}: ${d.intervals.map((i) => `${i.start}–${i.end}`).join(", ")}`,
    )
    .join(" | ");

  // Busca agendamentos existentes para conflict check (próximos 7 dias)
  const fromIso = new Date().toISOString();
  const toIso = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agendaCtx = { db: db as any, orgId };
  let existingAppointments: Awaited<ReturnType<typeof listAppointments>> = [];
  try {
    existingAppointments = await listAppointments(agendaCtx, {
      user_id: userId,
      from: fromIso,
      to: toIso,
      kinds: ["appointment", "block"],
      statuses: ["awaiting_confirmation", "confirmed", "rescheduled"],
    });
  } catch {
    // Best-effort
  }

  // Gera os próximos 5 slots livres (nos próximos 7 dias)
  const suggested: string[] = [];
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: rule.timezone });
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);

  for (let i = 0; i < 7 && suggested.length < 5; i++) {
    const dayMs = todayMs + i * 24 * 60 * 60_000;
    const dateStr = new Date(dayMs).toLocaleDateString("sv-SE", {
      timeZone: rule.timezone,
    });
    const daySlots = getAvailableSlots({
      date: dateStr,
      rule,
      duration_minutes: durationMinutes,
      buffer_minutes: 0,
      existing: existingAppointments,
    });
    for (const slot of daySlots.slice(0, 2)) {
      // Formato: "2026-06-16T10:00:00-03:00 (Seg)" — IA usa direto como start_at
      const isoWithTz = slot.start_at;
      const dayName = new Date(dayMs).toLocaleDateString("pt-BR", {
        timeZone: rule.timezone,
        weekday: "short",
      });
      suggested.push(`${isoWithTz} (${dayName} ${slot.display_time})`);
      if (suggested.length >= 5) break;
    }
  }

  return {
    available_hours: available || "nenhum horario habilitado",
    timezone: rule.timezone,
    suggested_slots: suggested,
  };
}

export async function insertLeadActivity(params: {
  db: AgentDb;
  organizationId: string;
  leadId: string;
  type: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await params.db.from("lead_activities").insert({
    organization_id: params.organizationId,
    lead_id: params.leadId,
    type: params.type,
    description: params.description,
    metadata: {
      source: "ai_agent",
      ...params.metadata,
    },
    performed_by: null,
    created_at: nowIso(),
  });
}
