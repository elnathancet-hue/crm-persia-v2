"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getCustomFields() {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("custom_fields")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createCustomField(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const name = formData.get("name") as string;
  const fieldKey = formData.get("field_key") as string;
  const fieldType = formData.get("field_type") as string;
  const optionsRaw = formData.get("options") as string;

  const options = optionsRaw
    ? optionsRaw
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  const { data, error } = await supabase
    .from("custom_fields")
    .insert({
      organization_id: orgId,
      name,
      field_key: fieldKey,
      field_type: fieldType,
      options: fieldType === "select" ? options : [],
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/leads/fields");
  return data;
}

export async function updateCustomField(id: string, formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const updateData: Record<string, any> = {};
  const name = formData.get("name") as string;
  const fieldType = formData.get("field_type") as string;
  const optionsRaw = formData.get("options") as string;

  if (name) updateData.name = name;
  if (fieldType) updateData.field_type = fieldType;
  if (optionsRaw !== null) {
    updateData.options = optionsRaw
      ? optionsRaw
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      : [];
  }

  const { error } = await supabase
    .from("custom_fields")
    .update(updateData as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads/fields");
}

export async function deleteCustomField(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  // Remove values first
  await supabase.from("lead_custom_field_values").delete().eq("custom_field_id", id).eq("organization_id", orgId);
  const { error } = await supabase.from("custom_fields").delete().eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads/fields");
}

// ============================================================================
// PR-E: Lead-side custom fields (read + write inline no Drawer)
// ============================================================================

export interface LeadCustomFieldDef {
  id: string;
  name: string;
  field_key: string;
  field_type: string;
  options: string[]; // parsed do JSONB
  is_required: boolean;
  sort_order: number;
}

export interface LeadCustomFieldEntry {
  field: LeadCustomFieldDef;
  /** Valor TEXT do banco. Vazio = nao preenchido. */
  value: string;
}

/**
 * PR-E: lista as definicoes de campos custom da org JOIN com valores
 * do lead. Resultado pronto pra renderizacao dinamica no drawer.
 *
 * Multi-tenant: orgId scoping em ambas tabelas (defesa em camadas
 * — RLS ja deveria proteger, mas explicito).
 *
 * Ordem: sort_order ASC dos campos. Campos sem valor retornam value=""
 * (nao quebra render).
 */
export async function getLeadCustomFields(
  leadId: string,
): Promise<LeadCustomFieldEntry[]> {
  const { supabase, orgId } = await requireRole("agent");

  // Defesa multi-tenant: confirma que o lead pertence ao org
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) return [];

  // Buscar definicoes + valores em paralelo
  const [defsRes, valuesRes] = await Promise.all([
    supabase
      .from("custom_fields")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("lead_custom_field_values")
      .select("custom_field_id, value")
      .eq("lead_id", leadId)
      .eq("organization_id", orgId),
  ]);

  if (defsRes.error) throw new Error(defsRes.error.message);
  const defs = (defsRes.data ?? []) as Array<{
    id: string;
    name: string;
    field_key: string;
    field_type: string;
    options: unknown;
    is_required: boolean | null;
    sort_order: number | null;
  }>;
  const values = (valuesRes.data ?? []) as Array<{
    custom_field_id: string;
    value: string | null;
  }>;
  const valueMap = new Map(values.map((v) => [v.custom_field_id, v.value ?? ""]));

  return defs.map((def) => ({
    field: {
      id: def.id,
      name: def.name,
      field_key: def.field_key,
      field_type: def.field_type,
      // options vem JSONB — pode ser null, array, ou objeto. Coerce
      // pra string[] defensivamente.
      options: Array.isArray(def.options)
        ? def.options.map(String)
        : [],
      is_required: !!def.is_required,
      sort_order: def.sort_order ?? 0,
    },
    value: valueMap.get(def.id) ?? "",
  }));
}

/**
 * PR-E: upsert do valor de um custom field pra um lead.
 *
 * Estrategia: usa UNIQUE(lead_id, custom_field_id) pra
 * upsert via onConflict. Se value for "" (vazio), DELETA
 * a linha em vez de gravar string vazia — mantem DB limpo.
 *
 * Multi-tenant: confirma lead+field pertencem ao org antes
 * de gravar.
 */
export async function setLeadCustomFieldValue(
  leadId: string,
  customFieldId: string,
  value: string,
): Promise<{ success: boolean }> {
  const { supabase, orgId } = await requireRole("agent");

  // Defesa: lead + field do mesmo org
  const [{ data: lead }, { data: field }] = await Promise.all([
    supabase
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("custom_fields")
      .select("id")
      .eq("id", customFieldId)
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);

  if (!lead) throw new Error("Lead não encontrado nesta organização");
  if (!field) throw new Error("Campo não encontrado nesta organização");

  // Vazio = remove linha (nao salva string vazia poluindo DB)
  if (value.trim() === "") {
    const { error } = await supabase
      .from("lead_custom_field_values")
      .delete()
      .eq("lead_id", leadId)
      .eq("custom_field_id", customFieldId)
      .eq("organization_id", orgId);
    if (error) throw new Error(error.message);
    revalidatePath(`/leads/${leadId}`);
    return { success: true };
  }

  // Upsert via INSERT ... ON CONFLICT no constraint UNIQUE
  // (lead_id, custom_field_id). updated_at e tocado pelo trigger
  // set_updated_at em lead_custom_field_values.
  const { error } = await supabase
    .from("lead_custom_field_values")
    .upsert(
      {
        organization_id: orgId,
        lead_id: leadId,
        custom_field_id: customFieldId,
        value,
      },
      { onConflict: "lead_id,custom_field_id" },
    );

  if (error) throw new Error(error.message);
  revalidatePath(`/leads/${leadId}`);
  return { success: true };
}
