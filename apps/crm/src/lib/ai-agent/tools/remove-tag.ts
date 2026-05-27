import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import {
  failureResult,
  getHandlerDb,
  insertLeadActivity,
  successResult,
} from "./shared";

// PR-6 Auditoria (mai/2026): endereca rodada 1 #3 + rodada 4 matriz.
// `remove_tag` ja aparecia em FlowActionType e no catalogo da UI, mas
// nao tinha handler. Runner emitia guardrail "handler nao implementado"
// e seguia a edge default — cliente acreditava que a tag foi removida
// quando nada acontecia.
//
// Espelha o padrao do add-tag.ts: resolve tag pelo nome (ilike
// case-insensitive), faz DELETE em lead_tags se o vinculo existe,
// registra audit em lead_activities. Respeita dry_run.
//
// Diferenca vs add_tag: nao CRIA tag se nao existir — apenas reporta
// que nao havia vinculo. Faz sentido: pra remover algo, tem que existir.

const removeTagSchema = z.object({
  tag_name: z.string().trim().min(1).max(80),
});

function normalizeTagName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export const removeTagHandler: NativeHandler = async (context, input) => {
  const parsed = removeTagSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const tagName = normalizeTagName(parsed.data.tag_name);

  // Lookup case-insensitive no catalogo de tags da org. Se nao existir
  // a tag em si, nao ha nada pra remover do lead — sucesso no-op.
  const { data: tagRow, error: tagLookupError } = await db
    .from("tags")
    .select("id, name")
    .eq("organization_id", context.organization_id)
    .ilike("name", tagName)
    .maybeSingle();

  if (tagLookupError) return failureResult(tagLookupError.message);

  if (!tagRow) {
    return successResult(
      {
        tag_id: null,
        tag_name: tagName,
        removed: false,
        reason: "tag_not_in_catalog",
      },
      [`tag "${tagName}" nao existe no catalogo — nada a remover`],
    );
  }

  const tagRowTyped = tagRow as { id: string; name: string };

  // Verifica se o lead realmente tem essa tag — pra reportar resultado
  // honesto ao cliente (e LLM, quando chamada via tool).
  const { data: leadTagRow, error: leadTagLookupError } = await db
    .from("lead_tags")
    .select("lead_id, tag_id")
    .eq("organization_id", context.organization_id)
    .eq("lead_id", context.lead_id)
    .eq("tag_id", tagRowTyped.id)
    .maybeSingle();

  if (leadTagLookupError) return failureResult(leadTagLookupError.message);

  if (!leadTagRow) {
    return successResult(
      {
        tag_id: tagRowTyped.id,
        tag_name: tagName,
        removed: false,
        reason: "lead_does_not_have_tag",
      },
      [`lead nao tinha a tag "${tagName}" — nada a remover`],
    );
  }

  if (context.dry_run) {
    return successResult(
      {
        tag_id: tagRowTyped.id,
        tag_name: tagName,
        removed: true,
      },
      [`would remove tag "${tagName}" from lead`],
    );
  }

  const { error: deleteError } = await db
    .from("lead_tags")
    .delete()
    .eq("organization_id", context.organization_id)
    .eq("lead_id", context.lead_id)
    .eq("tag_id", tagRowTyped.id);

  if (deleteError) return failureResult(deleteError.message);

  // Audit no historico do lead — operador ve no LeadDrawer trilha "Acoes
  // da IA" o que foi removido (paridade com add_tag).
  await insertLeadActivity({
    db,
    organizationId: context.organization_id,
    leadId: context.lead_id,
    type: "tag_removed",
    description: `IA removeu tag "${tagName}"`,
    metadata: { tag_id: tagRowTyped.id, tag_name: tagName },
  });

  return successResult(
    {
      tag_id: tagRowTyped.id,
      tag_name: tagName,
      removed: true,
    },
    [`removed tag "${tagName}" from lead`],
  );
};
