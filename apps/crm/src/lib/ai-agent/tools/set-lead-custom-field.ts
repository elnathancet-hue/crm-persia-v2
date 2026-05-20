// AI Agent — handler `set_lead_custom_field`.
//
// PR-FLOW-PIVOT PR 8 (mai/2026): IA escreve em `lead_custom_field_values`.
// Paridade com `edit_lead_ia: true` do flow.json do Jordan Moura.
//
// Fluxo:
//   1. Valida input via Zod ({ field_key, value }).
//   2. Resolve custom_field_id por (organization_id, field_key) — único.
//      Retorna failure se field_key não existe (cliente não cadastrou).
//   3. Upsert em lead_custom_field_values por (lead_id, custom_field_id) —
//      UNIQUE constraint da migration 001. Update se já existe.
//   4. Loga side_effect descritivo pro Tester/audit.
//
// V1 não converte tipo (number/date/bool). Armazena sempre TEXT como o
// schema espera. CRM converte na leitura.

import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { failureResult, getHandlerDb, successResult } from "./shared";

const setLeadCustomFieldSchema = z.object({
  field_key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    // Slug pattern — letras minúsculas, números, hífen, underscore. Bate
    // com como `custom_fields.field_key` é cadastrado no CRM UI.
    .regex(/^[a-z0-9_-]+$/, "field_key deve ser slug (a-z, 0-9, _, -)"),
  value: z.string().max(2000),
});

export const setLeadCustomFieldHandler: NativeHandler = async (context, input) => {
  const parsed = setLeadCustomFieldSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid set_lead_custom_field input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const { field_key, value } = parsed.data;
  const db = getHandlerDb(context);
  if (!db) {
    return failureResult("handler context missing db");
  }
  if (!context.lead_id) {
    return failureResult("no lead_id in context — cannot set custom field");
  }

  // Em dry_run (Tester), simula sem tocar DB.
  if (context.dry_run) {
    return successResult(
      { field_key, value, simulated: true },
      [`(dry_run) set lead.custom_fields.${field_key} = "${value}"`],
    );
  }

  // 1. Resolve custom_field_id por (org, field_key).
  const { data: fieldRow, error: fieldErr } = await db
    .from("custom_fields")
    .select("id, field_type")
    .eq("organization_id", context.organization_id)
    .eq("field_key", field_key)
    .maybeSingle();
  if (fieldErr) {
    return failureResult(`failed to lookup custom_field: ${fieldErr.message}`);
  }
  if (!fieldRow) {
    return failureResult(`custom_field "${field_key}" não cadastrado no CRM`);
  }
  const customFieldId = (fieldRow as { id: string }).id;

  // 2. Upsert no value. UNIQUE constraint (lead_id, custom_field_id)
  //    do schema da migration 001 garante 1 row por (lead, field).
  const { error: upsertErr } = await db.from("lead_custom_field_values").upsert(
    {
      lead_id: context.lead_id,
      custom_field_id: customFieldId,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "lead_id,custom_field_id" },
  );
  if (upsertErr) {
    return failureResult(`failed to upsert value: ${upsertErr.message}`);
  }

  // PR-FLOW-PIVOT PR 12 (mai/2026): custom field afeta regras de
  // segmentos (futuro — V1 segments só matcha em tags/status/score/
  // dates, mas o hook é barato e protege quando rules expandirem).
  // Fire-and-forget pra não atrasar resposta da IA.
  import("@/lib/segments/lead-hook")
    .then(({ dispatchSegmentMembershipHook }) =>
      dispatchSegmentMembershipHook(context.organization_id, context.lead_id),
    )
    .catch((err) =>
      console.error(
        "[set-lead-custom-field] segment evaluator error:",
        err,
      ),
    );

  return successResult(
    { field_key, value, custom_field_id: customFieldId },
    [`set lead.custom_fields.${field_key} = "${value}"`],
  );
};
