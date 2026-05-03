"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadminForOrg } from "@/lib/auth";
import {
  type AgendaReminderConfig,
  type AgendaReminderSend,
  DEFAULT_REMINDERS,
  type ReminderChannel,
  type ReminderTriggerWhen,
} from "@persia/shared/agenda";

const RETURN_CONFIG = `
  id, organization_id, name, trigger_when, trigger_offset_minutes,
  channel, template_text, is_active, created_at, updated_at
`;

const RETURN_SEND = `
  id, appointment_id, reminder_config_id, organization_id,
  scheduled_for, sent_at, status, message_id, error,
  attempted_count, created_at, updated_at
`;

export type { AgendaReminderConfig, AgendaReminderSend };

type LooseDb = { from: (table: string) => any };

function loose(admin: unknown): LooseDb {
  return admin as LooseDb;
}

export async function getReminderConfigs(): Promise<AgendaReminderConfig[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await loose(admin)
    .from("agenda_reminder_configs")
    .select(RETURN_CONFIG)
    .eq("organization_id", orgId)
    .order("trigger_when", { ascending: true })
    .order("trigger_offset_minutes", { ascending: false });
  if (error) throw new Error(`getReminderConfigs: ${error.message}`);
  return (data ?? []) as AgendaReminderConfig[];
}

export async function getReminderConfigById(
  id: string,
): Promise<AgendaReminderConfig | null> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await loose(admin)
    .from("agenda_reminder_configs")
    .select(RETURN_CONFIG)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getReminderConfigById: ${error.message}`);
  return (data as AgendaReminderConfig | null) ?? null;
}

export async function getReminderSendsForAppointment(
  appointmentId: string,
): Promise<AgendaReminderSend[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await loose(admin)
    .from("agenda_reminder_sends")
    .select(RETURN_SEND)
    .eq("organization_id", orgId)
    .eq("appointment_id", appointmentId)
    .order("scheduled_for", { ascending: true });
  if (error) throw new Error(`getReminderSendsForAppointment: ${error.message}`);
  return (data ?? []) as AgendaReminderSend[];
}

export interface CreateReminderConfigInput {
  name: string;
  trigger_when: ReminderTriggerWhen;
  trigger_offset_minutes: number;
  channel?: ReminderChannel;
  template_text: string;
  is_active?: boolean;
}

export async function createReminderConfig(
  input: CreateReminderConfigInput,
): Promise<AgendaReminderConfig> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await loose(admin)
    .from("agenda_reminder_configs")
    .insert({
      organization_id: orgId,
      name: input.name,
      trigger_when: input.trigger_when,
      trigger_offset_minutes:
        input.trigger_when === "on_create" ? 0 : input.trigger_offset_minutes,
      channel: input.channel ?? "whatsapp",
      template_text: input.template_text,
      is_active: input.is_active ?? true,
    })
    .select(RETURN_CONFIG)
    .single();
  if (error) throw new Error(`createReminderConfig: ${error.message}`);
  revalidatePath(`/clients/${orgId}/agenda`);
  return data as AgendaReminderConfig;
}

export interface UpdateReminderConfigInput {
  name?: string;
  trigger_when?: ReminderTriggerWhen;
  trigger_offset_minutes?: number;
  channel?: ReminderChannel;
  template_text?: string;
  is_active?: boolean;
}

export async function updateReminderConfig(
  id: string,
  input: UpdateReminderConfigInput,
): Promise<AgendaReminderConfig> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.trigger_when !== undefined) patch.trigger_when = input.trigger_when;
  if (input.trigger_offset_minutes !== undefined)
    patch.trigger_offset_minutes =
      input.trigger_when === "on_create" || patch.trigger_when === "on_create"
        ? 0
        : input.trigger_offset_minutes;
  if (input.channel !== undefined) patch.channel = input.channel;
  if (input.template_text !== undefined)
    patch.template_text = input.template_text;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const { data, error } = await loose(admin)
    .from("agenda_reminder_configs")
    .update(patch)
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(RETURN_CONFIG)
    .single();
  if (error) throw new Error(`updateReminderConfig: ${error.message}`);
  revalidatePath(`/clients/${orgId}/agenda`);
  return data as AgendaReminderConfig;
}

export async function deleteReminderConfig(id: string): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await loose(admin)
    .from("agenda_reminder_configs")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`deleteReminderConfig: ${error.message}`);
  revalidatePath(`/clients/${orgId}/agenda`);
}

export async function seedDefaultReminderConfigs(): Promise<
  AgendaReminderConfig[]
> {
  const { admin, orgId } = await requireSuperadminForOrg();

  const { data: existing } = await loose(admin)
    .from("agenda_reminder_configs")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1);
  if (existing && existing.length > 0) return [];

  const inserts = DEFAULT_REMINDERS.map((d) => ({
    organization_id: orgId,
    name: d.name,
    trigger_when: d.trigger_when,
    trigger_offset_minutes: d.trigger_offset_minutes,
    channel: "whatsapp" as const,
    template_text: d.template_text,
    is_active: true,
  }));

  const { data, error } = await loose(admin)
    .from("agenda_reminder_configs")
    .insert(inserts)
    .select(RETURN_CONFIG);
  if (error) throw new Error(`seedDefaultReminderConfigs: ${error.message}`);
  revalidatePath(`/clients/${orgId}/agenda`);
  return (data ?? []) as AgendaReminderConfig[];
}
