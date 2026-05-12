// PR-S5: queries puras pra campos personalizados (lead_field_defs +
// lead_field_values). Compartilhado entre CRM e admin.
//
// Defs: por org. Values: 1 valor TEXT por (lead, field).
// Vazio = remove linha (nao polui DB com strings vazias).

import type { CrmQueryContext } from "./context";

export interface LeadCustomFieldDef {
  id: string;
  name: string;
  field_key: string;
  field_type: string;
  options: string[];
  is_required: boolean;
  sort_order: number;
}

export interface LeadCustomFieldEntry {
  field: LeadCustomFieldDef;
  /** Valor TEXT do banco. Vazio = nao preenchido. */
  value: string;
}

/**
 * Lista defs + valores joinados pro tab Campos do drawer.
 * Ordem: sort_order ASC. Campos sem valor retornam value="" (UI
 * renderiza placeholder).
 *
 * Multi-tenant: orgId scoping em ambas tabelas. Service-role bypassa
 * RLS, defesa em camada.
 */
export async function fetchLeadCustomFields(
  ctx: CrmQueryContext,
  leadId: string,
): Promise<LeadCustomFieldEntry[]> {
  const { db, orgId } = ctx;

  // Tabelas reais (migration 001): custom_fields (defs por org) +
  // lead_custom_field_values (valores por lead).
  const [defsRes, valuesRes] = await Promise.all([
    db
      .from("custom_fields")
      .select(
        "id, name, field_key, field_type, options, is_required, sort_order",
      )
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true }),
    db
      .from("lead_custom_field_values")
      .select("custom_field_id, value")
      .eq("lead_id", leadId)
      .eq("organization_id", orgId),
  ]);

  type DefRow = {
    id: string;
    name: string;
    field_key: string;
    field_type: string;
    options: string[] | string | null;
    is_required: boolean;
    sort_order: number;
  };
  type ValRow = { custom_field_id: string; value: string };

  const defs = (defsRes.data ?? []) as DefRow[];
  const values = (valuesRes.data ?? []) as ValRow[];

  // Options pode vir como JSONB string ou array — parser defensivo.
  const parseOptions = (raw: string[] | string | null): string[] => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  return defs.map((def) => {
    const found = values.find((v) => v.custom_field_id === def.id);
    return {
      field: {
        id: def.id,
        name: def.name,
        field_key: def.field_key,
        field_type: def.field_type,
        options: parseOptions(def.options),
        is_required: def.is_required,
        sort_order: def.sort_order,
      },
      value: found?.value ?? "",
    };
  });
}

/**
 * Set valor TEXT de um campo custom no lead.
 *   - value vazio (apos trim) = DELETE da linha
 *   - value preenchido = UPSERT (composite PK lead_id + custom_field_id)
 *
 * Multi-tenant: confirma lead + field do mesmo org antes de gravar.
 */
export async function upsertLeadCustomFieldValue(
  ctx: CrmQueryContext,
  leadId: string,
  customFieldId: string,
  value: string,
): Promise<{ success: boolean }> {
  const { db, orgId } = ctx;

  // Defesa: lead + field do mesmo org
  const [{ data: lead }, { data: field }] = await Promise.all([
    db
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    db
      .from("custom_fields")
      .select("id")
      .eq("id", customFieldId)
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);

  if (!lead) throw new Error("Lead não encontrado nesta organização");
  if (!field) throw new Error("Campo não encontrado nesta organização");

  const trimmed = value.trim();
  if (trimmed === "") {
    const { error } = await db
      .from("lead_custom_field_values")
      .delete()
      .eq("lead_id", leadId)
      .eq("custom_field_id", customFieldId)
      .eq("organization_id", orgId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db
      .from("lead_custom_field_values")
      .upsert(
        {
          organization_id: orgId,
          lead_id: leadId,
          custom_field_id: customFieldId,
          value: trimmed,
        },
        { onConflict: "lead_id,custom_field_id" },
      );
    if (error) throw new Error(error.message);
  }

  return { success: true };
}
