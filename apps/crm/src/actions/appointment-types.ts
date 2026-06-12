"use server";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

// PR-AI-AGENT-APPOINTMENT-TYPES (mai/2026): CRUD pra `agenda_services`
// (tabela existente de 031). Cliente cadastra os tipos que a IA pode
// agendar — "Consulta inicial 30min", "Avaliacao 60min", etc — em vez
// da IA inventar titulos e duracoes a cada conversa.

export interface AppointmentType {
  id: string;
  organization_id: string;
  slug: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  default_channel: "whatsapp" | "phone" | "online" | "in_person" | null;
  default_location: string | null;
  default_meeting_url: string | null;
  // C2 (jun/2026): profissional padrão para este tipo de serviço (migration 115)
  default_user_id: string | null;
  price_cents: number | null;
  color: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrgMemberOption {
  user_id: string;
  name: string;
}

export async function getOrgMembersForSelect(): Promise<OrgMemberOption[]> {
  const { orgId } = await requireRole("admin");
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("organization_members")
    .select("user_id, role, profiles(full_name)")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .in("role", ["owner", "admin", "agent"])
    .order("created_at", { ascending: true });

  if (!members) return [];

  return (members as Array<{ user_id: string; profiles?: { full_name?: string } | null }>).map(
    (m) => ({
      user_id: m.user_id,
      name: m.profiles?.full_name || m.user_id.slice(0, 8),
    }),
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function getAppointmentTypes(): Promise<AppointmentType[]> {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("agenda_services")
    .select("*")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as AppointmentType[]) || [];
}

export interface CreateAppointmentTypeInput {
  name: string;
  description?: string;
  duration_minutes: number;
  default_channel?: AppointmentType["default_channel"];
  default_location?: string;
  default_meeting_url?: string;
  default_user_id?: string | null;
  price_cents?: number | null;
  color?: string | null;
}

export async function createAppointmentType(
  input: CreateAppointmentTypeInput,
): Promise<AppointmentType> {
  const { supabase, orgId } = await requireRole("admin");

  if (!input.name?.trim()) throw new Error("Nome obrigatorio");
  if (
    !Number.isFinite(input.duration_minutes) ||
    input.duration_minutes < 5 ||
    input.duration_minutes > 1440
  ) {
    throw new Error("Duracao deve estar entre 5 e 1440 minutos");
  }

  const slug = slugify(input.name);
  if (!slug) throw new Error("Nome invalido (slug vazio)");

  const { data, error } = await supabase
    .from("agenda_services")
    .insert({
      organization_id: orgId,
      slug,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      duration_minutes: input.duration_minutes,
      default_channel: input.default_channel ?? null,
      default_location: input.default_location?.trim() || null,
      default_meeting_url: input.default_meeting_url?.trim() || null,
      default_user_id: input.default_user_id ?? null,
      price_cents: input.price_cents ?? null,
      color: input.color ?? null,
    })
    .select()
    .single();

  if (error) {
    // Slug duplicado (unique constraint) — mensagem clara
    if (error.code === "23505") {
      throw new Error("Ja existe um tipo de agendamento com esse nome");
    }
    throw new Error(error.message);
  }
  revalidatePath("/automations/appointments");
  revalidatePath("/agenda");
  return data as AppointmentType;
}

export interface UpdateAppointmentTypeInput {
  name?: string;
  description?: string | null;
  duration_minutes?: number;
  default_channel?: AppointmentType["default_channel"];
  default_location?: string | null;
  default_meeting_url?: string | null;
  default_user_id?: string | null;
  price_cents?: number | null;
  color?: string | null;
  is_active?: boolean;
}

export async function updateAppointmentType(
  id: string,
  input: UpdateAppointmentTypeInput,
): Promise<void> {
  const { supabase, orgId } = await requireRole("admin");

  // Whitelist explícita — evita mass assignment via `...input` spread.
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    // Re-slug quando nome muda.
    updates.name = input.name.trim();
    updates.slug = slugify(input.name);
  }
  if (input.description !== undefined)         updates.description = input.description;
  if (input.duration_minutes !== undefined)    updates.duration_minutes = input.duration_minutes;
  if (input.default_channel !== undefined)     updates.default_channel = input.default_channel;
  if (input.default_location !== undefined)    updates.default_location = input.default_location;
  if (input.default_meeting_url !== undefined) updates.default_meeting_url = input.default_meeting_url;
  if (input.default_user_id !== undefined)     updates.default_user_id = input.default_user_id;
  if (input.price_cents !== undefined)         updates.price_cents = input.price_cents;
  if (input.color !== undefined)               updates.color = input.color;
  if (input.is_active !== undefined)           updates.is_active = input.is_active;

  const { error } = await supabase
    .from("agenda_services")
    .update(updates as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) {
    if (error.code === "23505") {
      throw new Error("Ja existe um tipo de agendamento com esse nome");
    }
    throw new Error(error.message);
  }
  revalidatePath("/automations/appointments");
  revalidatePath("/agenda");
}

export async function deleteAppointmentType(id: string): Promise<void> {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase
    .from("agenda_services")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/automations/appointments");
  revalidatePath("/agenda");
}
