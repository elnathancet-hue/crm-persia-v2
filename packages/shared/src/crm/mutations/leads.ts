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

export type UpdateLeadInput = Partial<CreateLeadInput>;

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
