import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import {
  failureResult,
  getHandlerDb,
  insertLeadActivity,
  successResult,
} from "./shared";

const addTagSchema = z.object({
  tag_name: z.string().trim().min(1).max(80),
});

function normalizeTagName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export const addTagHandler: NativeHandler = async (context, input) => {
  const parsed = addTagSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const tagName = normalizeTagName(parsed.data.tag_name);

  const { data: existingTag, error: tagLookupError } = await db
    .from("tags")
    .select("id, name")
    .eq("organization_id", context.organization_id)
    .eq("name", tagName)
    .maybeSingle();

  if (tagLookupError) return failureResult(tagLookupError.message);

  if (context.dry_run) {
    return successResult(
      {
        tag_id: existingTag?.id ?? null,
        tag_name: tagName,
        created: !existingTag,
      },
      [
        existingTag
          ? `would attach tag ${tagName} to lead`
          : `would create tag ${tagName} and attach to lead`,
      ],
    );
  }

  let created = false;
  let tagId: string;

  if (existingTag?.id) {
    tagId = existingTag.id as string;
  } else {
    const { data: createdTag, error: createTagError } = await db
      .from("tags")
      .insert({
        organization_id: context.organization_id,
        name: tagName,
        color: "#6366f1",
      })
      .select("id, name")
      .single();

    if (createTagError || !createdTag) {
      return failureResult(createTagError?.message ?? "failed to create tag");
    }

    created = true;
    tagId = createdTag.id as string;
  }

  const { error: leadTagError } = await db
    .from("lead_tags")
    .upsert({
      organization_id: context.organization_id,
      lead_id: context.lead_id,
      tag_id: tagId,
    });

  if (leadTagError) return failureResult(leadTagError.message);

  // PR-AGENT-INTEGRATION-1: log no historico do lead pra que operador
  // veja no LeadDrawer o que a IA fez (Trilha "Acoes da IA").
  await insertLeadActivity({
    db,
    organizationId: context.organization_id,
    leadId: context.lead_id,
    type: "tag_added",
    description: `IA adicionou tag "${tagName}"`,
    metadata: { tag_id: tagId, tag_name: tagName, created_tag: created },
  });

  return successResult(
    {
      tag_id: tagId,
      tag_name: tagName,
      created,
    },
    [`attached tag ${tagName} to lead`],
  );
};

