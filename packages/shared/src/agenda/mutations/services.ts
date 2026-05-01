// agenda_services — mutations.

import type { AgendaService } from "../types";
import type { AgendaMutationContext } from "../queries/context";

const RETURN = `
  id, organization_id, name, description,
  duration_minutes, price_cents, color, is_active,
  created_at, updated_at
`;

export interface CreateAgendaServiceInput {
  name: string;
  description?: string | null;
  duration_minutes: number;
  price_cents?: number | null;
  color?: string | null;
  is_active?: boolean;
}

export async function createAgendaService(
  ctx: AgendaMutationContext,
  input: CreateAgendaServiceInput,
): Promise<AgendaService> {
  const { db, orgId } = ctx;
  const { data, error } = await db
    .from("agenda_services")
    .insert({
      organization_id: orgId,
      name: input.name,
      description: input.description ?? null,
      duration_minutes: input.duration_minutes,
      price_cents: input.price_cents ?? null,
      color: input.color ?? null,
      is_active: input.is_active ?? true,
    })
    .select(RETURN)
    .single();
  if (error) throw new Error(`createAgendaService: ${error.message}`);
  return data as AgendaService;
}

export interface UpdateAgendaServiceInput {
  name?: string;
  description?: string | null;
  duration_minutes?: number;
  price_cents?: number | null;
  color?: string | null;
  is_active?: boolean;
}

export async function updateAgendaService(
  ctx: AgendaMutationContext,
  id: string,
  input: UpdateAgendaServiceInput,
): Promise<AgendaService> {
  const { db, orgId } = ctx;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.duration_minutes !== undefined)
    patch.duration_minutes = input.duration_minutes;
  if (input.price_cents !== undefined) patch.price_cents = input.price_cents;
  if (input.color !== undefined) patch.color = input.color;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const { data, error } = await db
    .from("agenda_services")
    .update(patch)
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(RETURN)
    .single();
  if (error) throw new Error(`updateAgendaService: ${error.message}`);
  return data as AgendaService;
}

export async function deleteAgendaService(
  ctx: AgendaMutationContext,
  id: string,
): Promise<void> {
  const { db, orgId } = ctx;
  const { error } = await db
    .from("agenda_services")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`deleteAgendaService: ${error.message}`);
}
