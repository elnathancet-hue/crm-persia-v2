// Leads — mutations compartilhadas entre apps/crm e apps/admin.
//
// Throw em qualquer erro de DB. Wrappers nos apps adaptam o shape pro
// contrato historico de cada um (CRM: throw direto; admin: try/catch
// + { data, error }).

import type { CrmMutationContext } from "./context";

export interface CreateLeadInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string;
  status?: string;
  channel?: string;
}

/**
 * UpdateLeadInput cobre os mesmos campos de criacao + os campos do
 * drawer "Informações do lead" (Fase 2: address_*, notes, website,
 * assigned_to). Todos opcionais — undefined = nao mexe; null/'' = limpa.
 */
export interface UpdateLeadInput extends Partial<CreateLeadInput> {
  website?: string | null;
  assigned_to?: string | null;
  address_country?: string | null;
  address_state?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_complement?: string | null;
  notes?: string | null;
}

export interface CreatedLead {
  id: string;
  organization_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  status: string;
  channel: string;
  // Inclui o resto do row inteiro — usado pelo merge phone-existing path.
  [key: string]: unknown;
}

const DEFAULT_SOURCE = "manual";
const DEFAULT_STATUS = "new";
const DEFAULT_CHANNEL = "whatsapp";

/**
 * Cria um lead no org. Se `phone` foi informado e ja existe um lead com
 * esse phone no org, faz MERGE em vez de duplicar (preenche name/email
 * que estavam null no existente). O webhook do WhatsApp pode ter criado
 * o lead antes do usuario abrir o form — esse path evita lead duplicado.
 */
export async function createLead(
  ctx: CrmMutationContext,
  input: CreateLeadInput,
): Promise<CreatedLead> {
  const { db, orgId } = ctx;
  const phone = input.phone || null;

  if (phone) {
    const { data: existing, error: lookupError } = await db
      .from("leads")
      .select("*")
      .eq("organization_id", orgId)
      .eq("phone", phone)
      .maybeSingle();

    if (lookupError) throw new Error(lookupError.message);

    if (existing) {
      const existingRow = existing as Record<string, unknown>;
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.name && !existingRow.name) patch.name = input.name;
      if (input.email && !existingRow.email) patch.email = input.email;

      const { error: updateError } = await db
        .from("leads")
        .update(patch)
        .eq("id", existingRow.id as string);

      if (updateError) throw new Error(updateError.message);

      ctx.onLeadChanged?.(existingRow.id as string);
      return { ...existingRow, ...patch } as CreatedLead;
    }
  }

  const { data, error } = await db
    .from("leads")
    .insert({
      organization_id: orgId,
      name: input.name || null,
      phone,
      email: input.email || null,
      source: input.source || DEFAULT_SOURCE,
      status: input.status || DEFAULT_STATUS,
      channel: input.channel || DEFAULT_CHANNEL,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Lead nao foi criado");

  const created = data as CreatedLead;
  ctx.onLeadChanged?.(created.id);
  return created;
}

/**
 * Atualiza um lead. So altera campos passados — campos omitidos ficam
 * inalterados. Org-scoping garante que so leads do org sao atualizados.
 * Throw em erro de DB ou se o lead nao pertence ao org.
 */
export async function updateLead(
  ctx: CrmMutationContext,
  leadId: string,
  input: UpdateLeadInput,
): Promise<CreatedLead> {
  const { db, orgId } = ctx;

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) updateData.name = input.name || null;
  if (input.phone !== undefined) updateData.phone = input.phone || null;
  if (input.email !== undefined) updateData.email = input.email || null;
  if (input.source) updateData.source = input.source;
  if (input.status) updateData.status = input.status;
  if (input.channel) updateData.channel = input.channel;

  // Campos do drawer "Informações do lead" (Fase 2). Undefined preserva,
  // null/'' limpa explicitamente.
  if (input.website !== undefined) updateData.website = input.website || null;
  if (input.assigned_to !== undefined)
    updateData.assigned_to = input.assigned_to || null;
  if (input.address_country !== undefined)
    updateData.address_country = input.address_country || null;
  if (input.address_state !== undefined)
    updateData.address_state = input.address_state || null;
  if (input.address_city !== undefined)
    updateData.address_city = input.address_city || null;
  if (input.address_zip !== undefined)
    updateData.address_zip = input.address_zip || null;
  if (input.address_street !== undefined)
    updateData.address_street = input.address_street || null;
  if (input.address_number !== undefined)
    updateData.address_number = input.address_number || null;
  if (input.address_neighborhood !== undefined)
    updateData.address_neighborhood = input.address_neighborhood || null;
  if (input.address_complement !== undefined)
    updateData.address_complement = input.address_complement || null;
  if (input.notes !== undefined) updateData.notes = input.notes || null;

  const { data, error } = await db
    .from("leads")
    .update(updateData)
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Lead nao encontrado nesta organizacao");

  ctx.onLeadChanged?.(leadId);
  return data as CreatedLead;
}

/**
 * Deleta um lead do org. Cascade no DB se houver FK (lead_tags,
 * lead_activities, deals etc).
 */
export async function deleteLead(
  ctx: CrmMutationContext,
  leadId: string,
): Promise<void> {
  const { db, orgId } = ctx;

  const { error } = await db
    .from("leads")
    .delete()
    .eq("id", leadId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}
