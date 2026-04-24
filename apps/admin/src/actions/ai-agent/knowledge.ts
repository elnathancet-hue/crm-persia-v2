"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_UPLOAD_MAX_BYTES,
  FAQ_ANSWER_MAX_CHARS,
  FAQ_ANSWER_MIN_CHARS,
  FAQ_QUESTION_MAX_CHARS,
  FAQ_QUESTION_MIN_CHARS,
  KNOWLEDGE_STORAGE_BUCKET,
  type AgentKnowledgeSource,
  type CreateDocumentInput,
  type CreateFAQInput,
  type DocumentMimeType,
  type KnowledgeSourceMetadata,
  type UpdateFAQInput,
} from "@persia/shared/ai-agent";
import { fromAny, type AgentDb } from "@/lib/ai-agent/db";
import type { AdminClient } from "@/lib/supabase-admin";
import {
  agentPaths,
  assertConfigBelongsToOrg,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

// ============================================================================
// Listing
// ============================================================================

export async function listKnowledgeSources(
  orgId: string,
  configId: string,
): Promise<AgentKnowledgeSource[]> {
  const { db } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await fromAny(db, "agent_knowledge_sources")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentKnowledgeSource[];
}

// ============================================================================
// FAQ
// ============================================================================

export async function createFAQ(
  orgId: string,
  input: CreateFAQInput,
): Promise<AgentKnowledgeSource> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const normalized = normalizeFAQInput(input);
    await assertConfigBelongsToOrg(db, orgId, normalized.config_id);

    const metadata: KnowledgeSourceMetadata = {
      question: normalized.question,
      answer: normalized.answer,
    };

    const { data: source, error: sourceError } = await fromAny(
      db,
      "agent_knowledge_sources",
    )
      .insert({
        organization_id: orgId,
        config_id: normalized.config_id,
        source_type: "faq",
        title: normalized.title,
        metadata,
        status: "active",
        indexing_status: "pending",
      })
      .select("*")
      .single();

    if (sourceError || !source) {
      throw new Error(sourceError?.message || "Erro ao criar FAQ");
    }

    await enqueueIndexingJob(db, orgId, (source as AgentKnowledgeSource).id);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_faq_create",
      entityType: "agent_knowledge_source",
      entityId: (source as AgentKnowledgeSource).id,
      metadata: { config_id: normalized.config_id },
    });

    for (const path of agentPaths(normalized.config_id)) revalidatePath(path);
    return source as AgentKnowledgeSource;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_faq_create",
      entityType: "agent_knowledge_source",
      metadata: { config_id: input.config_id },
      error,
    });
    throw error;
  }
}

export async function updateFAQ(
  orgId: string,
  sourceId: string,
  input: UpdateFAQInput,
): Promise<AgentKnowledgeSource> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertSourceBelongsToOrg(db, orgId, sourceId);
    if (existing.source_type !== "faq") throw new Error("Fonte nao e um FAQ");

    const currentMeta = existing.metadata as Extract<
      KnowledgeSourceMetadata,
      { question: string }
    >;
    const patch = normalizeFAQPatch(input);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.status !== undefined) updates.status = patch.status;

    const contentChanged =
      patch.question !== undefined || patch.answer !== undefined;
    if (contentChanged) {
      updates.metadata = {
        question: patch.question ?? currentMeta.question,
        answer: patch.answer ?? currentMeta.answer,
      } satisfies KnowledgeSourceMetadata;
      updates.indexing_status = "pending";
      updates.indexing_error = null;
      updates.indexed_at = null;
    }

    const { data, error } = await fromAny(db, "agent_knowledge_sources")
      .update(updates)
      .eq("organization_id", orgId)
      .eq("id", sourceId)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Erro ao atualizar FAQ");
    }

    if (contentChanged) {
      await enqueueIndexingJob(db, orgId, sourceId);
    }

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_faq_update",
      entityType: "agent_knowledge_source",
      entityId: sourceId,
      metadata: { config_id: existing.config_id, reindex: contentChanged },
    });

    for (const path of agentPaths(existing.config_id)) revalidatePath(path);
    return data as AgentKnowledgeSource;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_faq_update",
      entityType: "agent_knowledge_source",
      entityId: sourceId,
      error,
    });
    throw error;
  }
}

// ============================================================================
// Documents
// ============================================================================

export async function createDocument(
  orgId: string,
  input: CreateDocumentInput,
): Promise<AgentKnowledgeSource> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const normalized = normalizeDocumentInput(input);
    await assertConfigBelongsToOrg(db, orgId, normalized.config_id);

    const metadata: KnowledgeSourceMetadata = {
      storage_path: normalized.storage_path,
      mime_type: normalized.mime_type,
      size_bytes: normalized.size_bytes,
      original_filename: normalized.original_filename,
    };

    const { data: source, error: sourceError } = await fromAny(
      db,
      "agent_knowledge_sources",
    )
      .insert({
        organization_id: orgId,
        config_id: normalized.config_id,
        source_type: "document",
        title: normalized.title,
        metadata,
        status: "active",
        indexing_status: "pending",
      })
      .select("*")
      .single();

    if (sourceError || !source) {
      throw new Error(sourceError?.message || "Erro ao registrar documento");
    }

    await enqueueIndexingJob(db, orgId, (source as AgentKnowledgeSource).id);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_document_create",
      entityType: "agent_knowledge_source",
      entityId: (source as AgentKnowledgeSource).id,
      metadata: {
        config_id: normalized.config_id,
        filename: normalized.original_filename,
        size_bytes: normalized.size_bytes,
      },
    });

    for (const path of agentPaths(normalized.config_id)) revalidatePath(path);
    return source as AgentKnowledgeSource;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_document_create",
      entityType: "agent_knowledge_source",
      metadata: { config_id: input.config_id },
      error,
    });
    throw error;
  }
}

export async function uploadDocument(
  orgId: string,
  configId: string,
  formData: FormData,
): Promise<AgentKnowledgeSource> {
  const { db, admin } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);

  const file = formData.get("file");
  const title = (formData.get("title") as string | null)?.trim();

  if (!(file instanceof File)) throw new Error("Arquivo obrigatorio");
  if (!title) throw new Error("Titulo obrigatorio");

  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) {
    throw new Error(
      `Arquivo excede ${Math.round(DOCUMENT_UPLOAD_MAX_BYTES / 1024 / 1024)}MB`,
    );
  }
  if (
    !DOCUMENT_ALLOWED_MIME_TYPES.includes(file.type as DocumentMimeType)
  ) {
    throw new Error("Formato nao permitido. Use PDF, DOCX ou TXT.");
  }

  const sanitizedName = sanitizeStorageName(file.name);
  const storagePath = `${orgId}/${configId}/${randomUUID()}-${sanitizedName}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await (admin as AdminClient).storage
    .from(KNOWLEDGE_STORAGE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Falha no upload: ${uploadError.message}`);
  }

  return createDocument(orgId, {
    config_id: configId,
    title,
    storage_path: storagePath,
    mime_type: file.type as DocumentMimeType,
    size_bytes: file.size,
    original_filename: file.name,
  });
}

// ============================================================================
// Delete + reindex
// ============================================================================

export async function deleteKnowledgeSource(
  orgId: string,
  sourceId: string,
): Promise<void> {
  const { db, admin, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertSourceBelongsToOrg(db, orgId, sourceId);

    if (existing.source_type === "document") {
      const meta = existing.metadata as Extract<
        KnowledgeSourceMetadata,
        { storage_path: string }
      >;
      await (admin as AdminClient).storage
        .from(KNOWLEDGE_STORAGE_BUCKET)
        .remove([meta.storage_path]);
    }

    const { error } = await fromAny(db, "agent_knowledge_sources")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", sourceId);

    if (error) throw new Error(error.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_knowledge_delete",
      entityType: "agent_knowledge_source",
      entityId: sourceId,
      metadata: { config_id: existing.config_id, source_type: existing.source_type },
    });

    for (const path of agentPaths(existing.config_id)) revalidatePath(path);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_knowledge_delete",
      entityType: "agent_knowledge_source",
      entityId: sourceId,
      error,
    });
    throw error;
  }
}

export async function reindexKnowledgeSource(
  orgId: string,
  sourceId: string,
): Promise<AgentKnowledgeSource> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertSourceBelongsToOrg(db, orgId, sourceId);

    const { data, error } = await fromAny(db, "agent_knowledge_sources")
      .update({
        indexing_status: "pending",
        indexing_error: null,
        indexed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", sourceId)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Erro ao reenfileirar indexacao");
    }

    await enqueueIndexingJob(db, orgId, sourceId);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_knowledge_reindex",
      entityType: "agent_knowledge_source",
      entityId: sourceId,
      metadata: { config_id: existing.config_id },
    });

    for (const path of agentPaths(existing.config_id)) revalidatePath(path);
    return data as AgentKnowledgeSource;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_knowledge_reindex",
      entityType: "agent_knowledge_source",
      entityId: sourceId,
      error,
    });
    throw error;
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function assertSourceBelongsToOrg(
  db: AgentDb,
  orgId: string,
  sourceId: string,
): Promise<AgentKnowledgeSource> {
  const { data, error } = await fromAny(db, "agent_knowledge_sources")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", sourceId)
    .maybeSingle();
  if (error || !data) throw new Error("Fonte nao encontrada");
  return data as AgentKnowledgeSource;
}

async function enqueueIndexingJob(
  db: AgentDb,
  orgId: string,
  sourceId: string,
): Promise<void> {
  const { error } = await fromAny(db, "agent_indexing_jobs").insert({
    organization_id: orgId,
    source_id: sourceId,
    status: "pending",
  });
  if (error) {
    throw new Error(`Falha ao enfileirar indexacao: ${error.message}`);
  }
}

function normalizeFAQInput(input: CreateFAQInput): CreateFAQInput {
  const title = input.title?.trim();
  const question = input.question?.trim();
  const answer = input.answer?.trim();

  if (!input.config_id) throw new Error("config_id e obrigatorio");
  if (!title) throw new Error("Titulo e obrigatorio");
  if (!question || question.length < FAQ_QUESTION_MIN_CHARS) {
    throw new Error(`Pergunta muito curta (min ${FAQ_QUESTION_MIN_CHARS})`);
  }
  if (question.length > FAQ_QUESTION_MAX_CHARS) {
    throw new Error(`Pergunta muito longa (max ${FAQ_QUESTION_MAX_CHARS})`);
  }
  if (!answer || answer.length < FAQ_ANSWER_MIN_CHARS) {
    throw new Error(`Resposta muito curta (min ${FAQ_ANSWER_MIN_CHARS})`);
  }
  if (answer.length > FAQ_ANSWER_MAX_CHARS) {
    throw new Error(`Resposta muito longa (max ${FAQ_ANSWER_MAX_CHARS})`);
  }

  return { config_id: input.config_id, title, question, answer };
}

function normalizeFAQPatch(input: UpdateFAQInput): {
  title?: string;
  question?: string;
  answer?: string;
  status?: "active" | "archived";
} {
  const out: ReturnType<typeof normalizeFAQPatch> = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error("Titulo nao pode ficar vazio");
    out.title = title;
  }
  if (input.question !== undefined) {
    const q = input.question.trim();
    if (q.length < FAQ_QUESTION_MIN_CHARS) {
      throw new Error(`Pergunta muito curta (min ${FAQ_QUESTION_MIN_CHARS})`);
    }
    if (q.length > FAQ_QUESTION_MAX_CHARS) {
      throw new Error(`Pergunta muito longa (max ${FAQ_QUESTION_MAX_CHARS})`);
    }
    out.question = q;
  }
  if (input.answer !== undefined) {
    const a = input.answer.trim();
    if (a.length < FAQ_ANSWER_MIN_CHARS) {
      throw new Error(`Resposta muito curta (min ${FAQ_ANSWER_MIN_CHARS})`);
    }
    if (a.length > FAQ_ANSWER_MAX_CHARS) {
      throw new Error(`Resposta muito longa (max ${FAQ_ANSWER_MAX_CHARS})`);
    }
    out.answer = a;
  }
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "archived") {
      throw new Error("Status invalido");
    }
    out.status = input.status;
  }

  return out;
}

function normalizeDocumentInput(input: CreateDocumentInput): CreateDocumentInput {
  const title = input.title?.trim();
  if (!input.config_id) throw new Error("config_id e obrigatorio");
  if (!title) throw new Error("Titulo e obrigatorio");
  if (!input.storage_path) throw new Error("storage_path e obrigatorio");
  if (!DOCUMENT_ALLOWED_MIME_TYPES.includes(input.mime_type)) {
    throw new Error("Mime type nao permitido");
  }
  if (!Number.isFinite(input.size_bytes) || input.size_bytes <= 0) {
    throw new Error("size_bytes invalido");
  }
  if (input.size_bytes > DOCUMENT_UPLOAD_MAX_BYTES) {
    throw new Error("Arquivo excede limite");
  }

  return {
    config_id: input.config_id,
    title,
    storage_path: input.storage_path,
    mime_type: input.mime_type,
    size_bytes: input.size_bytes,
    original_filename: input.original_filename?.trim() || "documento",
  };
}

function sanitizeStorageName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "arquivo";
}
