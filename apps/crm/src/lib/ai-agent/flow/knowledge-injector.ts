import "server-only";

import { errorMessage, logError } from "@/lib/observability";
import { retrieveWithAttempt } from "../rag/retriever";
import type { AgentDb } from "../db";

/**
 * Knowledge inject (mai/2026) — feature "Documentos da base" no AI Agent.
 *
 * Contexto: o pivot pro Flow runtime quebrou o consumer de RAG. Os chunks
 * eram indexados em background mas o `runner.ts` nunca os lia, e a IA
 * respondia sem ver os documentos uplodados.
 *
 * Solução híbrida: 3 modos configuráveis em `agent_configs.knowledge_mode`:
 *
 *   - **full** (default): concatena TODOS chunks do agente no system
 *     prompt. Estilo ChatGPT — IA tem visão completa do doc. Funciona
 *     bem pra docs pequenos (FAQ, proposta comercial, regras de
 *     atendimento — tipicamente <30KB).
 *
 *   - **rag**: embed query do lead + top-k retrieval via pgvector.
 *     Reusa `retrieveWithAttempt()` e RPC `match_agent_knowledge_chunks`
 *     (migration 022, abr/2026). Pra docs grandes (>30KB total).
 *
 *   - **auto**: sistema decide. Soma bytes de todos chunks do agente —
 *     se <30KB usa full, senão usa rag.
 *
 * O helper retorna `null` quando:
 *   - Agente não tem nenhuma source com `indexing_status='completed'`
 *   - Retrieval falha (Voyage caiu, embedding error etc) — log + null
 *     pra não bloquear resposta da IA
 *
 * Caller (runner.ts) injeta o resultado entre `agentConfig.system_prompt`
 * e o warning de TOOL USAGE — fica como bloco contextual rotulado
 * "BASE DE CONHECIMENTO".
 */

export type KnowledgeMode = "full" | "rag" | "auto";

/** Threshold pra modo 'auto' decidir entre full e rag (bytes totais de chunks). */
const AUTO_FULL_BYTES_THRESHOLD = 30 * 1024; // 30KB

/** Top-k pro modo 'rag'. Ajustável depois via agent_configs se virar problema. */
const RAG_TOP_K = 3;

/**
 * Carrega `agent_configs.knowledge_mode` + chunks indexados do agente.
 * Retorna bloco formatado pra injetar no system prompt, ou null se
 * não houver conhecimento disponível.
 */
export async function buildKnowledgeBlock(
  db: AgentDb,
  organizationId: string,
  configId: string,
  queryText: string,
): Promise<string | null> {
  // Best-effort: knowledge inject NUNCA pode quebrar o AI node. Se
  // qualquer query falhar (schema fora de sincronia, RLS, Voyage caiu,
  // tabela ausente etc), log + return null. IA segue respondendo
  // normalmente sem contexto de docs.
  try {
    return await buildKnowledgeBlockUnsafe(db, organizationId, configId, queryText);
  } catch (error) {
    logError("ai_agent_knowledge_inject_failed", {
      organization_id: organizationId,
      config_id: configId,
      error: errorMessage(error),
    });
    return null;
  }
}

async function buildKnowledgeBlockUnsafe(
  db: AgentDb,
  organizationId: string,
  configId: string,
  queryText: string,
): Promise<string | null> {
  // 1. Le knowledge_mode (default 'full' se coluna ausente — defensive
  //    contra ambientes pré-migration 069)
  let mode: KnowledgeMode = "full";
  {
    const { data } = await db
      .from("agent_configs")
      .select("knowledge_mode")
      .eq("organization_id", organizationId)
      .eq("id", configId)
      .maybeSingle();
    const value = (data as { knowledge_mode?: string | null } | null)?.knowledge_mode;
    if (value === "rag" || value === "auto" || value === "full") {
      mode = value;
    }
  }

  // 2. Resolve mode 'auto' antes do trabalho pesado — só conta bytes
  if (mode === "auto") {
    const totalBytes = await measureKnowledgeBytes(db, organizationId, configId);
    if (totalBytes === 0) return null; // sem conhecimento
    mode = totalBytes < AUTO_FULL_BYTES_THRESHOLD ? "full" : "rag";
  }

  // 3. Dispatch pro modo final
  if (mode === "full") {
    return await buildFullModeBlock(db, organizationId, configId);
  }

  // mode === 'rag'
  return await buildRagModeBlock(organizationId, configId, queryText, db);
}

// ----------------------------------------------------------------------------
// Mode = 'full' — concatena TODOS chunks
// ----------------------------------------------------------------------------

async function buildFullModeBlock(
  db: AgentDb,
  organizationId: string,
  configId: string,
): Promise<string | null> {
  // Carrega TODOS chunks completed do agente, ordenados por source+chunk_index
  // pra preservar a ordem natural do documento original
  const { data, error } = await db
    .from("agent_knowledge_chunks")
    .select(
      "content, chunk_index, source:agent_knowledge_sources!inner(title, indexing_status, agent_config_id, organization_id)",
    )
    .eq("source.organization_id", organizationId)
    .eq("source.agent_config_id", configId)
    .eq("source.indexing_status", "completed")
    .order("source_id", { ascending: true })
    .order("chunk_index", { ascending: true });

  if (error) {
    logError("ai_agent_knowledge_full_load_failed", {
      organization_id: organizationId,
      config_id: configId,
      error: errorMessage(error),
    });
    return null;
  }

  type Row = {
    content: string;
    chunk_index: number;
    source: { title?: string | null } | { title?: string | null }[] | null;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return null;

  // Agrupa por source pra rotular cada documento
  // (Supabase pode retornar `source` como objeto ou array dependendo do schema)
  const sectionsBySource = new Map<string, { title: string; parts: string[] }>();
  let lastTitle = "Documento";
  for (const row of rows) {
    const sourceRow = Array.isArray(row.source) ? row.source[0] : row.source;
    const title = sourceRow?.title?.trim() || lastTitle;
    lastTitle = title;
    const existing = sectionsBySource.get(title) ?? { title, parts: [] };
    existing.parts.push(row.content);
    sectionsBySource.set(title, existing);
  }

  const sections = Array.from(sectionsBySource.values()).map((s) => {
    return `### ${s.title}\n${s.parts.join("\n").trim()}`;
  });

  return [
    "BASE DE CONHECIMENTO",
    "Use as informacoes abaixo como fonte de verdade ao responder perguntas do lead.",
    "Se o lead perguntar algo que NAO esta aqui, diga que nao tem essa informacao.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

// ----------------------------------------------------------------------------
// Mode = 'rag' — top-k retrieval via Voyage embedding + pgvector
// ----------------------------------------------------------------------------

async function buildRagModeBlock(
  organizationId: string,
  configId: string,
  queryText: string,
  db: AgentDb,
): Promise<string | null> {
  if (!queryText.trim()) return null; // sem query, sem retrieval

  const result = await retrieveWithAttempt(
    {
      organization_id: organizationId,
      config_id: configId,
      query_text: queryText.trim(),
      top_k: RAG_TOP_K,
      // audit=false: knowledge inject roda em runtime production por
      // padrão (não é tester preview). Mas mantemos false aqui pra não
      // poluir agent_steps com retrieval log por enquanto — V1 da
      // feature foca em entregar, audit log adicionamos quando virar
      // problema de observabilidade.
      audit: false,
    },
    db,
  );

  if (!result.success) {
    // logError já chamado dentro de retrieveWithAttempt
    return null;
  }

  if (result.hits.length === 0) {
    // Sem hits acima do threshold de similaridade — não injeta nada
    // (evita poluir prompt com chunks irrelevantes)
    return null;
  }

  const sections = result.hits.map((hit, idx) => {
    return `### Trecho ${idx + 1} — ${hit.source_title}\n${hit.content.trim()}`;
  });

  return [
    "BASE DE CONHECIMENTO (trechos relevantes pra essa pergunta)",
    "Use os trechos abaixo como fonte de verdade. Se a info que o lead pede",
    "nao esta neles, diga que nao tem essa informacao.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

// ----------------------------------------------------------------------------
// Helper: mede bytes totais dos chunks completed do agente
// ----------------------------------------------------------------------------

async function measureKnowledgeBytes(
  db: AgentDb,
  organizationId: string,
  configId: string,
): Promise<number> {
  const { data, error } = await db
    .from("agent_knowledge_chunks")
    .select(
      "content, source:agent_knowledge_sources!inner(agent_config_id, organization_id, indexing_status)",
    )
    .eq("source.organization_id", organizationId)
    .eq("source.agent_config_id", configId)
    .eq("source.indexing_status", "completed");

  if (error) {
    logError("ai_agent_knowledge_measure_failed", {
      organization_id: organizationId,
      config_id: configId,
      error: errorMessage(error),
    });
    return 0;
  }

  type Row = { content: string };
  const rows = (data ?? []) as Row[];
  return rows.reduce((sum, row) => sum + (row.content?.length ?? 0), 0);
}
