"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadminForOrg } from "@/lib/auth";

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
  price_cents: number | null;
  color: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function getAppointmentTypes(): Promise<AppointmentType[]> {
  const { admin, orgId } = await requireSuperadminForOrg();

  const { data, error } = await admin
    .from("agenda_services")
    .select("*")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as AppointmentType[]) || [];
}

export async function createAppointmentType(formData: FormData): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const duration = Number(formData.get("duration_minutes") ?? 30);
  const channel = String(formData.get("default_channel") ?? "") || null;

  if (!name) throw new Error("Nome obrigatório");
  if (!Number.isFinite(duration) || duration < 5 || duration > 1440) {
    throw new Error("Duracao deve estar entre 5 e 1440 minutos");
  }

  const slug = slugify(name);
  if (!slug) throw new Error("Nome invalido");

  const { error } = await admin.from("agenda_services").insert({
    organization_id: orgId,
    slug,
    name,
    description: description || null,
    duration_minutes: duration,
    default_channel: channel,
  } as never);

  if (error) {
    if (error.code === "23505") throw new Error("Ja existe um tipo com esse nome");
    throw new Error(error.message);
  }

  revalidatePath("/automations/appointments");
}

export async function toggleAppointmentType(id: string, isActive: boolean): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();

  const { error } = await admin
    .from("agenda_services")
    .update({ is_active: isActive, updated_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/automations/appointments");
}

export async function deleteAppointmentType(id: string): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();

  const { error } = await admin
    .from("agenda_services")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/automations/appointments");
}

export async function updateAppointmentType(
  id: string,
  input: {
    name?: string;
    description?: string;
    duration_minutes?: number;
    default_channel?: AppointmentType["default_channel"];
  },
): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description || null;
  if (input.duration_minutes !== undefined) updates.duration_minutes = input.duration_minutes;
  if (input.default_channel !== undefined) updates.default_channel = input.default_channel;

  const { error } = await admin
    .from("agenda_services")
    .update(updates as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/automations/appointments");
}
