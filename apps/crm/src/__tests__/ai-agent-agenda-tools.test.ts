// PR-AGENDA-TOOLS (mai/2026): tests dos 4 handlers AI Agent de agenda.
//
// Foco em:
//   - happy path (cria/lista/cancela/reagenda com sucesso)
//   - multi-tenant guard (appointment de outro lead/org rejeitado)
//   - dry-run nao escreve no DB
//   - input invalido retorna failureResult
//
// Notificacao WhatsApp (PR #220) eh mockada pra fire-and-forget.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseMock,
  type MockSupabase,
} from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
// Mock das notificacoes WhatsApp (fire-and-forget no caller — nao deve
// quebrar tests se provider/whatsapp_connections nao tiverem stub).
vi.mock("@/lib/agenda/notifications/dispatch", () => ({
  notifyLeadAppointmentCancelled: vi.fn(async () => ({
    sent: false,
    reason: "whatsapp_unavailable" as const,
  })),
  notifyLeadAppointmentRescheduled: vi.fn(async () => ({
    sent: false,
    reason: "whatsapp_unavailable" as const,
  })),
}));

import { createAppointmentHandler } from "@/lib/ai-agent/tools/create-appointment";
import { listLeadAppointmentsHandler } from "@/lib/ai-agent/tools/list-lead-appointments";
import { cancelAppointmentHandler } from "@/lib/ai-agent/tools/cancel-appointment";
import { rescheduleAppointmentHandler } from "@/lib/ai-agent/tools/reschedule-appointment";

// UUIDs RFC 4122 v4 — Zod v4 valida strict (posicao 13='4', posicao 17=[89ab])
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD_A = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb";
const USER_A = "cccccccc-cccc-4ccc-accc-cccccccccccc";
const APPT_A = "dddddddd-dddd-4ddd-bddd-dddddddddddd";
const APPT_FOREIGN_LEAD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OUTRO_LEAD = "ffffffff-ffff-4fff-9fff-ffffffffffff";

function ctx(supabase: MockSupabase, overrides: { dry_run?: boolean } = {}) {
  return {
    organization_id: ORG_A,
    lead_id: LEAD_A,
    crm_conversation_id: "conv-a",
    agent_conversation_id: "agent-conv-a",
    run_id: "run-a",
    dry_run: overrides.dry_run ?? false,
    db: supabase as never,
  } as never;
}

// Helper: future ISO date string +N hours from now.
function futureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// create_appointment
// ============================================================================

describe("createAppointmentHandler", () => {
  it("happy path — cria appointment com responsavel do lead", async () => {
    const supabase = createSupabaseMock();
    // 1. handler lookup do lead (resolve responsavel)
    supabase.queue("leads", {
      data: { id: LEAD_A, assigned_to: USER_A, timezone: "America/Sao_Paulo" },
      error: null,
    });
    // 2. shared ensureLeadBelongsToOrg (PR #218 multi-tenant guard)
    supabase.queue("leads", { data: { id: LEAD_A }, error: null });
    // 3. shared listConflictCandidates — vazio
    supabase.queue("appointments", { data: [], error: null });
    // 4. shared insert appointment
    supabase.queue("appointments", {
      data: {
        id: APPT_A,
        organization_id: ORG_A,
        kind: "appointment",
        title: "Consulta inicial",
        lead_id: LEAD_A,
        user_id: USER_A,
        start_at: futureIso(48),
        end_at: futureIso(49),
        duration_minutes: 60,
        timezone: "America/Sao_Paulo",
        status: "awaiting_confirmation",
        channel: null,
        location: null,
        meeting_url: null,
      },
      error: null,
    });
    // 4. appointment_history insert
    supabase.queue("appointment_history", { data: null, error: null });

    const result = await createAppointmentHandler(ctx(supabase), {
      start_at: futureIso(48),
      duration_minutes: 60,
      title: "Consulta inicial",
    });

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      appointment_id: APPT_A,
      lead_id: LEAD_A,
      user_id: USER_A,
      duration_minutes: 60,
      status: "awaiting_confirmation",
    });
  });

  it("rejeita quando lead nao tem responsavel", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { id: LEAD_A, assigned_to: null, timezone: null },
      error: null,
    });

    const result = await createAppointmentHandler(ctx(supabase), {
      start_at: futureIso(48),
      duration_minutes: 60,
      title: "Demo",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/responsavel/i);
    // Confirma que NAO chegou no insert
    expect(supabase.inserts.appointments).toBeUndefined();
  });

  it("rejeita start_at no passado", async () => {
    const supabase = createSupabaseMock();
    const past = new Date(Date.now() - 3600_000).toISOString();

    const result = await createAppointmentHandler(ctx(supabase), {
      start_at: past,
      duration_minutes: 60,
      title: "Demo",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/futuro/i);
  });

  it("rejeita input invalido (start_at malformado)", async () => {
    const supabase = createSupabaseMock();

    const result = await createAppointmentHandler(ctx(supabase), {
      start_at: "not-a-date",
      duration_minutes: 60,
      title: "Demo",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid tool input/i);
  });

  it("dry_run NAO escreve no DB", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { id: LEAD_A, assigned_to: USER_A, timezone: "America/Sao_Paulo" },
      error: null,
    });

    const result = await createAppointmentHandler(
      ctx(supabase, { dry_run: true }),
      {
        start_at: futureIso(48),
        duration_minutes: 60,
        title: "Demo dry",
      },
    );

    expect(result.success).toBe(true);
    expect((result.output as { dry_run: boolean }).dry_run).toBe(true);
    expect(supabase.inserts.appointments).toBeUndefined();
  });
});

// ============================================================================
// list_lead_appointments
// ============================================================================

describe("listLeadAppointmentsHandler", () => {
  it("happy path — lista appointments futuros do lead", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", {
      data: [
        {
          id: APPT_A,
          title: "Consulta",
          start_at: futureIso(48),
          end_at: futureIso(49),
          duration_minutes: 60,
          status: "confirmed",
          channel: "online",
          location: null,
          meeting_url: "https://meet.example/abc",
          timezone: "America/Sao_Paulo",
        },
      ],
      error: null,
    });

    const result = await listLeadAppointmentsHandler(ctx(supabase), {});

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      count: 1,
      only_upcoming: true,
    });
    const appts = (
      result.output as {
        appointments: Array<{ appointment_id: string; title: string }>;
      }
    ).appointments;
    expect(appts[0].appointment_id).toBe(APPT_A);
    expect(appts[0].title).toBe("Consulta");
  });

  it("only_upcoming=false retorna passado tambem", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", { data: [], error: null });

    const result = await listLeadAppointmentsHandler(ctx(supabase), {
      only_upcoming: false,
    });

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      count: 0,
      only_upcoming: false,
    });
  });
});

// ============================================================================
// cancel_appointment
// ============================================================================

describe("cancelAppointmentHandler", () => {
  it("happy path — cancela appointment do lead da conversa", async () => {
    const supabase = createSupabaseMock();
    // 1. lookup appointment
    supabase.queue("appointments", {
      data: { id: APPT_A, lead_id: LEAD_A, status: "confirmed" },
      error: null,
    });
    // 2. update appointment (cancelShared)
    supabase.queue("appointments", {
      data: {
        id: APPT_A,
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by_role: "agent",
        cancellation_reason: "lead pediu cancelar",
      },
      error: null,
    });
    // 3. history insert
    supabase.queue("appointment_history", { data: null, error: null });

    const result = await cancelAppointmentHandler(ctx(supabase), {
      appointment_id: APPT_A,
      reason: "lead pediu cancelar",
    });

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      appointment_id: APPT_A,
      status: "cancelled",
      cancelled_by_role: "agent",
      noop: false,
    });
  });

  it("REJEITA cancelar appointment de outro lead (cross-lead guard)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", {
      data: {
        id: APPT_FOREIGN_LEAD,
        lead_id: OUTRO_LEAD,
        status: "confirmed",
      },
      error: null,
    });

    const result = await cancelAppointmentHandler(ctx(supabase), {
      appointment_id: APPT_FOREIGN_LEAD,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nao pertence/i);
    expect(supabase.updates.appointments).toBeUndefined();
  });

  it("idempotente — appointment ja cancelado retorna noop=true", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", {
      data: { id: APPT_A, lead_id: LEAD_A, status: "cancelled" },
      error: null,
    });

    const result = await cancelAppointmentHandler(ctx(supabase), {
      appointment_id: APPT_A,
    });

    expect(result.success).toBe(true);
    expect((result.output as { noop: boolean }).noop).toBe(true);
    expect(supabase.updates.appointments).toBeUndefined();
  });

  it("rejeita appointment_id invalido (nao-uuid)", async () => {
    const supabase = createSupabaseMock();

    const result = await cancelAppointmentHandler(ctx(supabase), {
      appointment_id: "nao-eh-uuid",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid tool input/i);
  });
});

// ============================================================================
// reschedule_appointment
// ============================================================================

describe("rescheduleAppointmentHandler", () => {
  it("happy path — cria replacement + marca original como rescheduled", async () => {
    const supabase = createSupabaseMock();
    // 1. lookup appointment original
    supabase.queue("appointments", {
      data: {
        id: APPT_A,
        lead_id: LEAD_A,
        duration_minutes: 60,
        status: "confirmed",
      },
      error: null,
    });
    // shared.rescheduleAppointment chama getAppointment internamente
    supabase.queue("appointments", {
      data: {
        id: APPT_A,
        organization_id: ORG_A,
        kind: "appointment",
        title: "Demo",
        lead_id: LEAD_A,
        user_id: USER_A,
        start_at: futureIso(48),
        end_at: futureIso(49),
        duration_minutes: 60,
        timezone: "America/Sao_Paulo",
        status: "confirmed",
      },
      error: null,
    });
    // listConflictCandidates
    supabase.queue("appointments", { data: [], error: null });
    // update original -> rescheduled
    supabase.queue("appointments", {
      data: {
        id: APPT_A,
        status: "rescheduled",
        start_at: futureIso(48),
        end_at: futureIso(49),
      },
      error: null,
    });
    // insert replacement
    supabase.queue("appointments", {
      data: {
        id: "replacement-id",
        status: "awaiting_confirmation",
        start_at: futureIso(72),
        end_at: futureIso(73),
        duration_minutes: 60,
        rescheduled_from_id: APPT_A,
      },
      error: null,
    });
    // history insert
    supabase.queue("appointment_history", { data: null, error: null });

    const result = await rescheduleAppointmentHandler(ctx(supabase), {
      appointment_id: APPT_A,
      new_start_at: futureIso(72),
    });

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      original_id: APPT_A,
      replacement_id: "replacement-id",
      new_duration_minutes: 60,
    });
  });

  it("REJEITA reagendar appointment de outro lead", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", {
      data: {
        id: APPT_FOREIGN_LEAD,
        lead_id: OUTRO_LEAD,
        duration_minutes: 60,
        status: "confirmed",
      },
      error: null,
    });

    const result = await rescheduleAppointmentHandler(ctx(supabase), {
      appointment_id: APPT_FOREIGN_LEAD,
      new_start_at: futureIso(72),
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nao pertence/i);
  });

  it("rejeita new_start_at no passado", async () => {
    const supabase = createSupabaseMock();
    const past = new Date(Date.now() - 3600_000).toISOString();

    const result = await rescheduleAppointmentHandler(ctx(supabase), {
      appointment_id: APPT_A,
      new_start_at: past,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/futuro/i);
  });
});
