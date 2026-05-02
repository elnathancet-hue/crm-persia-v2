"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type Appointment,
  type AvailableSlot,
  type BookingPage,
  createAppointment as createAppointmentShared,
  getAvailableSlots,
  getBookingPage,
  getBookingPagePublicBySlug,
  getDefaultAvailabilityRule,
  listAppointments,
  projectLocalToUtc,
} from "@persia/shared/agenda";
import {
  checkSlotsRateLimit,
  checkSubmitRateLimit,
  getClientIp,
} from "@/lib/agenda/public-rate-limit";

const PHONE_REGEX = /^\+?[\d\s().-]{8,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper: admin client com tipagem solta pra acessar tabelas que ainda
// nao estao no @/types/database (regeneracao desde migration 031 pendente).
// Compativel com AgendaQueryDb das shared queries.
type LooseDb = { from: (table: string) => any };

function looseDb(): LooseDb {
  return createAdminClient() as unknown as LooseDb;
}

export interface ResolvedPublicBookingPage {
  page: BookingPage;
  organization: { id: string; name: string; slug: string };
  hostName: string;
}

/**
 * Resolve org+page por slugs. Retorna null se nao existir ou status != 'active'.
 */
export async function getPublicBookingPage(
  orgSlug: string,
  pageSlug: string,
): Promise<ResolvedPublicBookingPage | null> {
  const db = looseDb();
  const resolved = await getBookingPagePublicBySlug(db, orgSlug, pageSlug);
  if (!resolved) return null;

  // Tenta nome do owner. Profiles pode nao existir/RLS — fallback silencioso.
  let hostName = "";
  try {
    const { data: prof } = await db
      .from("profiles")
      .select("full_name")
      .eq("user_id", resolved.page.user_id)
      .maybeSingle();
    if (prof && typeof prof.full_name === "string") {
      hostName = prof.full_name as string;
    }
  } catch {
    // Sem profiles, segue sem nome.
  }

  return { ...resolved, hostName };
}

export interface PublicSlotsResult {
  slots: AvailableSlot[];
  timezone: string;
}

export async function getPublicSlotsForDate(
  pageId: string,
  date: string,
): Promise<PublicSlotsResult> {
  const ip = getClientIp(await headers());
  const rl = checkSlotsRateLimit(ip);
  if (!rl.allowed) {
    throw new Error(
      `Muitas requisições. Tente de novo em ${rl.retryAfterSeconds}s.`,
    );
  }

  const db = looseDb();

  const { data: pageRow, error: pageErr } = await db
    .from("booking_pages")
    .select(
      "id, organization_id, user_id, duration_minutes, buffer_minutes, lookahead_days, status",
    )
    .eq("id", pageId)
    .maybeSingle();
  if (pageErr || !pageRow) throw new Error("Página não encontrada");
  const page = pageRow as {
    id: string;
    organization_id: string;
    user_id: string;
    duration_minutes: number;
    buffer_minutes: number;
    lookahead_days: number;
    status: string;
  };
  if (page.status !== "active") throw new Error("Página não está ativa");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Data inválida");
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(today);
  max.setDate(max.getDate() + page.lookahead_days);
  const target = new Date(`${date}T12:00:00Z`);
  if (target.getTime() < today.getTime() - 86_400_000 || target.getTime() > max.getTime()) {
    throw new Error("Data fora do intervalo permitido");
  }

  const rule = await getDefaultAvailabilityRule(
    { db, orgId: page.organization_id },
    page.user_id,
  );
  if (!rule) {
    return { slots: [], timezone: "America/Sao_Paulo" };
  }

  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 2);
  const existing = await listAppointments(
    { db, orgId: page.organization_id },
    {
      from: dayStart.toISOString(),
      to: dayEnd.toISOString(),
      user_id: page.user_id,
      kinds: ["appointment", "block"],
      limit: 200,
    },
  );

  const slots = getAvailableSlots({
    date,
    rule,
    duration_minutes: page.duration_minutes,
    buffer_minutes: page.buffer_minutes,
    existing,
  });

  return { slots, timezone: rule.timezone };
}

export interface SubmitBookingInput {
  page_id: string;
  start_local: string;
  timezone: string;
  lead_name: string;
  lead_phone: string;
  lead_email?: string;
  notes?: string;
}

export interface BookingConfirmation {
  appointment_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  page_title: string;
  organization_name: string;
}

export async function submitPublicBooking(
  input: SubmitBookingInput,
): Promise<BookingConfirmation> {
  const ip = getClientIp(await headers());
  const rl = checkSubmitRateLimit(ip);
  if (!rl.allowed) {
    throw new Error(
      `Muitos agendamentos do mesmo dispositivo. Tente em ${rl.retryAfterSeconds}s.`,
    );
  }

  const name = input.lead_name?.trim() ?? "";
  if (name.length < 2) throw new Error("Nome obrigatório");
  const phone = input.lead_phone?.trim() ?? "";
  if (!PHONE_REGEX.test(phone)) throw new Error("Telefone inválido");
  if (input.lead_email && !EMAIL_REGEX.test(input.lead_email.trim())) {
    throw new Error("Email inválido");
  }

  const db = looseDb();

  const { data: pageRow, error: pageErr } = await db
    .from("booking_pages")
    .select(
      "id, organization_id, user_id, title, duration_minutes, buffer_minutes, status, location, meeting_url",
    )
    .eq("id", input.page_id)
    .maybeSingle();
  if (pageErr || !pageRow) throw new Error("Página não encontrada");
  const page = pageRow as {
    id: string;
    organization_id: string;
    user_id: string;
    title: string;
    duration_minutes: number;
    buffer_minutes: number;
    status: string;
    location: string | null;
    meeting_url: string | null;
  };
  if (page.status !== "active") throw new Error("Página não está ativa");

  const { data: orgRow } = await db
    .from("organizations")
    .select("name")
    .eq("id", page.organization_id)
    .maybeSingle();
  const orgName = (orgRow?.name as string | undefined) ?? "Sua agenda";

  const start_at = projectLocalToUtc(input.start_local, input.timezone);
  const end_ms =
    new Date(start_at).getTime() + page.duration_minutes * 60_000;
  const end_at = new Date(end_ms).toISOString();

  // Resolve/cria lead por phone (escopo da org)
  const { data: existingLead } = await db
    .from("leads")
    .select("id, name, email")
    .eq("organization_id", page.organization_id)
    .eq("phone", phone)
    .maybeSingle();

  let leadId: string;
  if (existingLead) {
    leadId = existingLead.id as string;
    const patch: Record<string, unknown> = {};
    if (name && !existingLead.name) patch.name = name;
    if (input.lead_email?.trim() && !existingLead.email) {
      patch.email = input.lead_email.trim();
    }
    if (Object.keys(patch).length > 0) {
      await db
        .from("leads")
        .update(patch)
        .eq("id", leadId)
        .eq("organization_id", page.organization_id);
    }
  } else {
    const { data: newLead, error: leadErr } = await db
      .from("leads")
      .insert({
        organization_id: page.organization_id,
        name,
        phone,
        email: input.lead_email?.trim() || null,
        source: "booking_page",
        status: "new",
        channel: "whatsapp",
      })
      .select("id")
      .single();
    if (leadErr || !newLead)
      throw new Error(`Erro criando lead: ${leadErr?.message}`);
    leadId = newLead.id as string;
  }

  // Cria appointment via shared mutation (ja faz conflict check + history)
  const created = await createAppointmentShared(
    {
      db,
      orgId: page.organization_id,
      userId: null,
      performedByRole: "lead",
    },
    {
      kind: "appointment",
      title: page.title,
      description: input.notes?.trim() || null,
      lead_id: leadId,
      user_id: page.user_id,
      service_id: null,
      booking_page_id: page.id,
      start_at,
      end_at,
      duration_minutes: page.duration_minutes,
      timezone: input.timezone,
      status: "awaiting_confirmation",
      channel: page.meeting_url ? "online" : null,
      location: page.location,
      meeting_url: page.meeting_url,
    },
  );

  // Incrementa total_bookings (best-effort, sem race-safety pra MVP)
  try {
    const current = await getBookingPage(
      { db, orgId: page.organization_id },
      page.id,
    );
    if (current) {
      await db
        .from("booking_pages")
        .update({ total_bookings: current.total_bookings + 1 })
        .eq("id", page.id)
        .eq("organization_id", page.organization_id);
    }
  } catch (err) {
    console.error("[public.submit] update total_bookings:", err);
  }

  return {
    appointment_id: created.id,
    start_at: created.start_at,
    end_at: created.end_at,
    timezone: input.timezone,
    page_title: page.title,
    organization_name: orgName,
  };
}

export type { Appointment };
