// Tests pra packages/shared/src/agenda/mutations/*
//
// Foco em:
//   - createAppointment com/sem conflito
//   - updateAppointmentStatus rejeita 'cancelled'
//   - cancelAppointment preserva metadata
//   - rescheduleAppointment cria replacement + marca original
//   - softDelete/restore
//   - createBookingPage valida slug + collision
//   - createAvailabilityRule com is_default desmarcata anteriores

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseMock,
  type MockSupabase,
} from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

import {
  AppointmentConflictError,
  AppointmentValidationError,
  BookingPageSlugError,
  cancelAppointment,
  createAppointment,
  createAvailabilityRule,
  createBookingPage,
  rescheduleAppointment,
  restoreAppointment,
  softDeleteAppointment,
  updateAppointment,
  updateAppointmentStatus,
  type AgendaMutationContext,
  type Appointment,
} from "@persia/shared/agenda";

const ORG = "00000000-0000-0000-0000-000000000001";
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

function ctx(supabase: MockSupabase): AgendaMutationContext {
  return {
    db: supabase as never,
    orgId: ORG,
    userId: USER_A,
    performedByRole: "agent",
  };
}

function makeAppt(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: overrides.id ?? "appt-1",
    organization_id: ORG,
    kind: "appointment",
    title: "Consulta",
    description: null,
    lead_id: null,
    user_id: USER_A,
    service_id: null,
    booking_page_id: null,
    start_at: "2026-05-04T13:00:00Z",
    end_at: "2026-05-04T14:00:00Z",
    duration_minutes: 60,
    timezone: "America/Sao_Paulo",
    status: "confirmed",
    channel: null,
    location: null,
    meeting_url: null,
    cancelled_at: null,
    cancelled_by_user_id: null,
    cancelled_by_role: null,
    cancellation_reason: null,
    rescheduled_from_id: null,
    confirmation_sent_at: null,
    reminder_sent_at: null,
    external_calendar_connection_id: null,
    external_event_id: null,
    external_synced_at: null,
    recurrence_rule: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// createAppointment
// ============================================================================

describe("createAppointment", () => {
  it("cria sem conflito (lista vazia de candidatos)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", { data: [], error: null }); // listConflictCandidates
    const created = makeAppt({ id: "new-appt" });
    supabase.queue("appointments", { data: created, error: null }); // insert
    supabase.queue("appointment_history", { data: null, error: null }); // history insert

    const result = await createAppointment(ctx(supabase), {
      kind: "appointment",
      title: "Nova consulta",
      description: null,
      lead_id: null,
      user_id: USER_A,
      service_id: null,
      booking_page_id: null,
      start_at: "2026-05-05T14:00:00Z",
      end_at: "2026-05-05T15:00:00Z",
      duration_minutes: 60,
      timezone: "America/Sao_Paulo",
      status: "awaiting_confirmation",
      channel: null,
      location: null,
      meeting_url: null,
    });

    expect(result.id).toBe("new-appt");
    expect(supabase.inserts.appointments?.[0]).toMatchObject({
      organization_id: ORG,
      title: "Nova consulta",
    });
    // history foi tentado
    expect(supabase.inserts.appointment_history?.[0]).toMatchObject({
      action: "created",
      organization_id: ORG,
    });
  });

  it("rejeita quando ha conflito real", async () => {
    const supabase = createSupabaseMock();
    const conflicting = makeAppt({
      id: "existing",
      start_at: "2026-05-05T14:00:00Z",
      end_at: "2026-05-05T15:00:00Z",
    });
    supabase.queue("appointments", { data: [conflicting], error: null });

    await expect(
      createAppointment(ctx(supabase), {
        kind: "appointment",
        title: "Conflito",
        description: null,
        lead_id: null,
        user_id: USER_A,
        service_id: null,
        booking_page_id: null,
        start_at: "2026-05-05T14:30:00Z",
        end_at: "2026-05-05T15:30:00Z",
        duration_minutes: 60,
        timezone: "America/Sao_Paulo",
        status: "awaiting_confirmation",
        channel: null,
        location: null,
        meeting_url: null,
      }),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
  });

  it("nao checa conflito quando enforce_conflict_check=false", async () => {
    const supabase = createSupabaseMock();
    const created = makeAppt({ id: "forced" });
    supabase.queue("appointments", { data: created, error: null });
    supabase.queue("appointment_history", { data: null, error: null });

    const result = await createAppointment(ctx(supabase), {
      kind: "appointment",
      title: "Forcado",
      description: null,
      lead_id: null,
      user_id: USER_A,
      service_id: null,
      booking_page_id: null,
      start_at: "2026-05-05T14:00:00Z",
      end_at: "2026-05-05T15:00:00Z",
      duration_minutes: 60,
      timezone: "America/Sao_Paulo",
      status: "awaiting_confirmation",
      channel: null,
      location: null,
      meeting_url: null,
      enforce_conflict_check: false,
    });
    expect(result.id).toBe("forced");
  });

  it("kind=block nao valida conflito (block JA eh um bloqueio)", async () => {
    const supabase = createSupabaseMock();
    // SO 2 calls: insert + history. Sem listConflictCandidates.
    const created = makeAppt({ id: "block-1", kind: "block" });
    supabase.queue("appointments", { data: created, error: null });
    supabase.queue("appointment_history", { data: null, error: null });

    const result = await createAppointment(ctx(supabase), {
      kind: "block",
      title: "Almoco",
      description: null,
      lead_id: null,
      user_id: USER_A,
      service_id: null,
      booking_page_id: null,
      start_at: "2026-05-05T15:00:00Z",
      end_at: "2026-05-05T16:00:00Z",
      duration_minutes: 60,
      timezone: "America/Sao_Paulo",
      status: "confirmed",
      channel: null,
      location: null,
      meeting_url: null,
    });
    expect(result.kind).toBe("block");
  });

  it("rejeita end <= start", async () => {
    const supabase = createSupabaseMock();
    await expect(
      createAppointment(ctx(supabase), {
        kind: "appointment",
        title: "Invalido",
        description: null,
        lead_id: null,
        user_id: USER_A,
        service_id: null,
        booking_page_id: null,
        start_at: "2026-05-05T14:00:00Z",
        end_at: "2026-05-05T13:00:00Z",
        duration_minutes: 60,
        timezone: "America/Sao_Paulo",
        status: "awaiting_confirmation",
        channel: null,
        location: null,
        meeting_url: null,
      }),
    ).rejects.toBeInstanceOf(AppointmentValidationError);
  });
});

// ============================================================================
// updateAppointmentStatus
// ============================================================================

describe("updateAppointmentStatus", () => {
  it("atualiza status simples", async () => {
    const supabase = createSupabaseMock();
    const updated = makeAppt({ id: "a1", status: "completed" });
    supabase.queue("appointments", { data: updated, error: null });
    supabase.queue("appointment_history", { data: null, error: null });

    const result = await updateAppointmentStatus(ctx(supabase), "a1", "completed");
    expect(result.status).toBe("completed");
    expect(supabase.inserts.appointment_history?.[0]).toMatchObject({
      action: "status_changed",
    });
  });

  it("rejeita status='cancelled' — exige cancelAppointment", async () => {
    const supabase = createSupabaseMock();
    await expect(
      updateAppointmentStatus(ctx(supabase), "a1", "cancelled"),
    ).rejects.toBeInstanceOf(AppointmentValidationError);
  });
});

// ============================================================================
// cancelAppointment
// ============================================================================

describe("cancelAppointment", () => {
  it("preserva motivo + autor + role", async () => {
    const supabase = createSupabaseMock();
    const cancelled = makeAppt({
      id: "a1",
      status: "cancelled",
      cancelled_at: "2026-05-05T10:00:00Z",
      cancelled_by_user_id: USER_A,
      cancelled_by_role: "agent",
      cancellation_reason: "Lead pediu pra remarcar",
    });
    supabase.queue("appointments", { data: cancelled, error: null });
    supabase.queue("appointment_history", { data: null, error: null });

    const result = await cancelAppointment(ctx(supabase), "a1", {
      reason: "Lead pediu pra remarcar",
    });

    expect(result.status).toBe("cancelled");
    expect(supabase.updates.appointments?.[0]).toMatchObject({
      status: "cancelled",
      cancelled_by_user_id: USER_A,
      cancelled_by_role: "agent",
      cancellation_reason: "Lead pediu pra remarcar",
    });
    expect(supabase.inserts.appointment_history?.[0]).toMatchObject({
      action: "cancelled",
    });
  });

  it("default cancelled_by_role = agent", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", { data: makeAppt(), error: null });
    supabase.queue("appointment_history", { data: null, error: null });

    await cancelAppointment(ctx(supabase), "a1");
    expect(supabase.updates.appointments?.[0]).toMatchObject({
      cancelled_by_role: "agent",
    });
  });

  it("history failure NAO quebra a action principal", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", { data: makeAppt(), error: null });
    supabase.queue("appointment_history", {
      data: null,
      error: { message: "RLS denied" },
    });

    // Deve retornar normal mesmo com history falhando (best-effort)
    const result = await cancelAppointment(ctx(supabase), "a1");
    expect(result.id).toBe("appt-1");
  });
});

// ============================================================================
// rescheduleAppointment
// ============================================================================

describe("rescheduleAppointment", () => {
  it("cria replacement + marca original como rescheduled", async () => {
    const supabase = createSupabaseMock();
    const original = makeAppt({ id: "orig-1", status: "confirmed" });
    // queries.getAppointment (busca o original)
    supabase.queue("appointments", { data: original, error: null });
    // listConflictCandidates
    supabase.queue("appointments", { data: [], error: null });
    // update do original
    supabase.queue("appointments", {
      data: { ...original, status: "rescheduled" },
      error: null,
    });
    // insert do novo
    const replacement = makeAppt({
      id: "new-1",
      status: "awaiting_confirmation",
      rescheduled_from_id: "orig-1",
      start_at: "2026-05-10T14:00:00Z",
      end_at: "2026-05-10T15:00:00Z",
    });
    supabase.queue("appointments", { data: replacement, error: null });
    // history
    supabase.queue("appointment_history", { data: null, error: null });

    const result = await rescheduleAppointment(ctx(supabase), "orig-1", {
      new_start_at: "2026-05-10T14:00:00Z",
      new_end_at: "2026-05-10T15:00:00Z",
    });

    expect(result.original.status).toBe("rescheduled");
    expect(result.replacement.id).toBe("new-1");
    expect(result.replacement.rescheduled_from_id).toBe("orig-1");
  });

  it("rejeita reagendar appointment ja cancelado/concluido", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", {
      data: makeAppt({ id: "orig-2", status: "cancelled" }),
      error: null,
    });

    await expect(
      rescheduleAppointment(ctx(supabase), "orig-2", {
        new_start_at: "2026-05-10T14:00:00Z",
        new_end_at: "2026-05-10T15:00:00Z",
      }),
    ).rejects.toBeInstanceOf(AppointmentValidationError);
  });

  it("rejeita reagendar event/block", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", {
      data: makeAppt({ id: "block-1", kind: "block" }),
      error: null,
    });

    await expect(
      rescheduleAppointment(ctx(supabase), "block-1", {
        new_start_at: "2026-05-10T14:00:00Z",
        new_end_at: "2026-05-10T15:00:00Z",
      }),
    ).rejects.toBeInstanceOf(AppointmentValidationError);
  });
});

// ============================================================================
// updateAppointment
// ============================================================================

describe("updateAppointment", () => {
  it("atualiza somente os campos enviados", async () => {
    const supabase = createSupabaseMock();
    const updated = makeAppt({ id: "a1", title: "Novo titulo" });
    supabase.queue("appointments", { data: updated, error: null });
    supabase.queue("appointment_history", { data: null, error: null });

    await updateAppointment(ctx(supabase), "a1", { title: "Novo titulo" });
    expect(supabase.updates.appointments?.[0]).toMatchObject({
      title: "Novo titulo",
    });
    // description NAO deveria estar no patch
    expect(supabase.updates.appointments?.[0]).not.toHaveProperty("description");
  });

  it("aceita nullify (description=null)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", {
      data: makeAppt({ description: null }),
      error: null,
    });
    supabase.queue("appointment_history", { data: null, error: null });

    await updateAppointment(ctx(supabase), "a1", { description: null });
    expect(supabase.updates.appointments?.[0]).toMatchObject({
      description: null,
    });
  });
});

// ============================================================================
// soft delete + restore
// ============================================================================

describe("softDeleteAppointment", () => {
  it("seta deleted_at + insere history", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", { data: null, error: null });
    supabase.queue("appointment_history", { data: null, error: null });

    await softDeleteAppointment(ctx(supabase), "a1");
    expect(supabase.updates.appointments?.[0]).toHaveProperty("deleted_at");
    expect(
      (supabase.updates.appointments?.[0] as { deleted_at: string | null })
        .deleted_at,
    ).not.toBeNull();
  });
});

describe("restoreAppointment", () => {
  it("zera deleted_at + insere history", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", {
      data: makeAppt({ id: "a1", deleted_at: null }),
      error: null,
    });
    supabase.queue("appointment_history", { data: null, error: null });

    await restoreAppointment(ctx(supabase), "a1");
    expect(supabase.updates.appointments?.[0]).toMatchObject({
      deleted_at: null,
    });
  });
});

// ============================================================================
// createBookingPage — validacao de slug + collision
// ============================================================================

describe("createBookingPage", () => {
  it("rejeita slug invalido (UPPERCASE)", async () => {
    const supabase = createSupabaseMock();
    await expect(
      createBookingPage(ctx(supabase), {
        user_id: USER_A,
        slug: "Consulta-Premium", // tem uppercase
        title: "Test",
        duration_minutes: 60,
      }),
    ).rejects.toBeInstanceOf(BookingPageSlugError);
  });

  it("rejeita slug com espaco", async () => {
    const supabase = createSupabaseMock();
    await expect(
      createBookingPage(ctx(supabase), {
        user_id: USER_A,
        slug: "consulta premium",
        title: "Test",
        duration_minutes: 60,
      }),
    ).rejects.toBeInstanceOf(BookingPageSlugError);
  });

  it("rejeita slug iniciado com hifen", async () => {
    const supabase = createSupabaseMock();
    await expect(
      createBookingPage(ctx(supabase), {
        user_id: USER_A,
        slug: "-consulta",
        title: "Test",
        duration_minutes: 60,
      }),
    ).rejects.toBeInstanceOf(BookingPageSlugError);
  });

  it("traduz erro de unique constraint pra BookingPageSlugError", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("booking_pages", {
      data: null,
      error: { message: "duplicate key", code: "23505" },
    });
    await expect(
      createBookingPage(ctx(supabase), {
        user_id: USER_A,
        slug: "consulta",
        title: "Test",
        duration_minutes: 60,
      }),
    ).rejects.toBeInstanceOf(BookingPageSlugError);
  });

  it("aceita slug valido", async () => {
    const supabase = createSupabaseMock();
    const page = {
      id: "bp-1",
      organization_id: ORG,
      slug: "consulta-premium",
      title: "Consulta Premium",
      duration_minutes: 60,
      status: "draft",
      total_bookings: 0,
      buffer_minutes: 0,
      lookahead_days: 30,
      user_id: USER_A,
      service_id: null,
      description: null,
      location: null,
      meeting_url: null,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
    };
    supabase.queue("booking_pages", { data: page, error: null });
    const result = await createBookingPage(ctx(supabase), {
      user_id: USER_A,
      slug: "consulta-premium",
      title: "Consulta Premium",
      duration_minutes: 60,
    });
    expect(result.id).toBe("bp-1");
  });
});

// ============================================================================
// createAvailabilityRule — is_default desmarca anteriores
// ============================================================================

describe("createAvailabilityRule", () => {
  it("quando is_default=true, limpa outras regras default do mesmo user", async () => {
    const supabase = createSupabaseMock();
    // 1) clearOtherDefaults (update)
    supabase.queue("availability_rules", { data: null, error: null });
    // 2) insert
    const created = {
      id: "rule-new",
      organization_id: ORG,
      user_id: USER_A,
      name: "Padrão",
      timezone: "America/Sao_Paulo",
      default_duration_minutes: 60,
      days: [],
      is_default: true,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
    };
    supabase.queue("availability_rules", { data: created, error: null });

    await createAvailabilityRule(ctx(supabase), {
      user_id: USER_A,
      is_default: true,
    });

    // O update foi chamado primeiro
    expect(supabase.updates.availability_rules?.[0]).toMatchObject({
      is_default: false,
    });
    // E depois o insert
    expect(supabase.inserts.availability_rules?.[0]).toMatchObject({
      organization_id: ORG,
      user_id: USER_A,
      is_default: true,
    });
  });

  it("quando is_default=false, NAO chama o clear", async () => {
    const supabase = createSupabaseMock();
    const created = {
      id: "rule-new",
      organization_id: ORG,
      user_id: USER_A,
      name: "Secundaria",
      timezone: "America/Sao_Paulo",
      default_duration_minutes: 60,
      days: [],
      is_default: false,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
    };
    supabase.queue("availability_rules", { data: created, error: null });

    await createAvailabilityRule(ctx(supabase), {
      user_id: USER_A,
      is_default: false,
    });

    // Sem update prévio
    expect(supabase.updates.availability_rules).toBeUndefined();
  });
});

// ============================================================================
// Multi-tenancy — filtros sempre carregam organization_id
// ============================================================================

describe("multi-tenancy", () => {
  it("createAppointment sempre seta organization_id do ctx, ignorando input", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("appointments", { data: [], error: null });
    supabase.queue("appointments", { data: makeAppt({ id: "x" }), error: null });
    supabase.queue("appointment_history", { data: null, error: null });

    await createAppointment(ctx(supabase), {
      kind: "appointment",
      title: "T",
      description: null,
      lead_id: null,
      user_id: USER_A,
      service_id: null,
      booking_page_id: null,
      start_at: "2026-06-01T14:00:00Z",
      end_at: "2026-06-01T15:00:00Z",
      duration_minutes: 60,
      timezone: "America/Sao_Paulo",
      status: "awaiting_confirmation",
      channel: null,
      location: null,
      meeting_url: null,
    });

    expect(supabase.inserts.appointments?.[0]).toMatchObject({
      organization_id: ORG,
    });
  });

  it("user diferente NAO afeta criacao de booking_page (so user_id input importa)", async () => {
    const supabase = createSupabaseMock();
    const page = {
      id: "bp-x",
      organization_id: ORG,
      slug: "test",
      title: "T",
      duration_minutes: 60,
      status: "draft",
      total_bookings: 0,
      buffer_minutes: 0,
      lookahead_days: 30,
      user_id: USER_B,
      service_id: null,
      description: null,
      location: null,
      meeting_url: null,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
    };
    supabase.queue("booking_pages", { data: page, error: null });

    const result = await createBookingPage(ctx(supabase), {
      user_id: USER_B,
      slug: "test",
      title: "T",
      duration_minutes: 60,
    });
    expect(result.user_id).toBe(USER_B);
    expect(supabase.inserts.booking_pages?.[0]).toMatchObject({
      organization_id: ORG,
      user_id: USER_B,
    });
  });
});
