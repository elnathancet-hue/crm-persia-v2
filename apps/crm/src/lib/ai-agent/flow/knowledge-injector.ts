import "server-only";

import { estimateTokens } from "@persia/shared/ai-agent";
import { errorMessage, logError } from "@/lib/observability";
import { retrieveWithAttempt } from "../rag/retriever";
import type { AgentDb } from "../db";
import { getCachedBlock, setCachedBlock } from "./knowledge-cache";

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

/**
 * Threshold pra modo 'auto' decidir entre full e rag, agora em TOKENS.
 *
 * Backlog #10 Auditoria (mai/2026): rodada 8 #3. Antes usavamos 30KB
 * (chars) que em PT-BR (~3 chars/token) equivale a ~10k tokens — alem
 * da janela pratica do gpt-4o-mini (~8k em prod somando system_prompt +
 * tools schema + history). Threshold em tokens reflete o limite real
 * que importa.
 *
 * Default 6000 tokens deixa folga pra ~2k de overhead (prompt + tools
 * schema + history) antes de bater na janela de 8k do gpt-4o-mini.
 */
const AUTO_FULL_TOKEN_THRESHOLD = 6000;

/**
 * Hard-cap UNIFICADO pra modo 'full' — aplica mesmo quando cliente
 * escolheu 'full' manualmente. PR-2 Auditoria (mai/2026): rodada 6 #5 +
 * rodada 8 #1. Antes, so o modo 'auto' aplicava o threshold; manual
 * 'full' nao tinha cap e podia injetar 100KB+ a cada turn.
 *
 * Backlog #10 (mai/2026): convertido pra TOKENS. 16000 tokens equivale
 * a ~48KB em PT-BR (proximo do 50KB anterior em bytes). Acima disso,
 * falla pra 'rag' com top-k retrieval.
 */
const FULL_MODE_HARD_CAP_TOKENS = 16000;

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

  // 2. Resolve mode 'auto' antes do trabalho pesado — Backlog #10: agora
  // mede em TOKENS estimados, nao bytes.
  if (mode === "auto") {
    const totalTokens = await measureKnowledgeTokens(db, organizationId, configId);
    if (totalTokens === 0) return null; // sem conhecimento
    mode = totalTokens < AUTO_FULL_TOKEN_THRESHOLD ? "full" : "rag";
  }

  // 2b. PR-2 Auditoria (mai/2026): hard-cap unificado pra 'full'.
  // Mesmo quando cliente forca 'full' manualmente em UI, derruba pra
  // 'rag' se ultrapassar FULL_MODE_HARD_CAP_TOKENS (16k). Sem isso, doc
  // grande × N turns × M conversas = factura explode silenciosamente.
  // Backlog #10 (mai/2026): cap convertido pra tokens estimados.
  if (mode === "full") {
    const totalTokens = await measureKnowledgeTokens(db, organizationId, configId);
    if (totalTokens === 0) return null; // sem conhecimento
    if (totalTokens > FULL_MODE_HARD_CAP_TOKENS) {
      logError("ai_agent_knowledge_full_exceeded_cap", {
        organization_id: organizationId,
        config_id: configId,
        total_tokens: totalTokens,
        cap_tokens: FULL_MODE_HARD_CAP_TOKENS,
        fallback_mode: "rag",
      });
      mode = "rag";
    }
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
  // Backlog #2 Auditoria (mai/2026): cache lookup com sources_hash check.
  // Endereca rodada 6 #5 + rodada 8 #1 — antes recarregavamos TUDO a cada
  // turn. Agora hash de (MAX(updated_at), COUNT(*)) detecta mudancas;
  // se nada mudou + cache fresh, retorna sem tocar agent_knowledge_chunks.
  //
  // Pequeno trade-off: SELECT de hash continua sendo feito em CADA
  // chamada (1 query barata), mas a query pesada de chunks so roda no
  // miss. Em orgs com doc grande, economia de ~50KB → ~50B por hit.
  const cacheKey = `full:${organizationId}:${configId}`;
  const sourcesHash = await computeFullModeSourcesHash(db, organizationId, configId);
  // Hash null = falha na query do hash. Skipamos cache pra nao servir
  // dado stale; cai direto pro load completo.
  if (sourcesHash !== null) {
    const cached = getCachedBlock(cacheKey, sourcesHash);
    if (cached !== undefined) {
      // Hit (cached pode ser null = "sem chunks"). Retorna direto sem
      // tocar DB pra os chunks.
      return cached;
    }
  }

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
  if (rows.length === 0) {
    // Backlog #2: cacheia "sem chunks" tambem — evita re-query enquanto
    // sources_hash nao mudar. Quando admin uplodar nova source, hash
    // muda e o cache invalida automaticamente.
    if (sourcesHash !== null) {
      setCachedBlock(cacheKey, null, sourcesHash);
    }
    return null;
  }

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

  const block = [
    "BASE DE CONHECIMENTO",
    "Use as informacoes abaixo como fonte de verdade ao responder perguntas do lead.",
    "Se o lead perguntar algo que NAO esta aqui, diga que nao tem essa informacao.",
    "",
    sections.join("\n\n"),
  ].join("\n");

  // Backlog #2: cacheia bloco computado.
  if (sourcesHash !== null) {
    setCachedBlock(cacheKey, block, sourcesHash);
  }

  return block;
}

/**
 * Backlog #2 Auditoria (mai/2026): hash leve pra detectar mudancas em
 * agent_knowledge_sources sem fazer query pesada de chunks. Combinacao
 * (MAX(updated_at), COUNT(*)) detecta:
 *   - source nova adicionada (count muda)
 *   - source existente reindexed (max(updated_at) muda)
 *   - source removida (count muda)
 *
 * Retorna null em caso de erro — caller skipa cache e cai pro load
 * completo (degradacao graciosa, sem perder consistencia).
 */
async function computeFullModeSourcesHash(
  db: AgentDb,
  organizationId: string,
  configId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("agent_knowledge_sources")
    .select("updated_at")
    .eq("organization_id", organizationId)
    .eq("agent_config_id", configId)
    .eq("indexing_status", "completed");

  if (error) {
    logError("ai_agent_knowledge_hash_failed", {
      organization_id: organizationId,
      config_id: configId,
      error: errorMessage(error),
    });
    return null;
  }

  const rows = (data ?? []) as Array<{ updated_at: string | null }>;
  if (rows.length === 0) return `empty:0`;

  let maxUpdated = "";
  for (const row of rows) {
    const value = row.updated_at ?? "";
    if (value > maxUpdated) maxUpdated = value;
  }
  return `${rows.length}:${maxUpdated}`;
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
// Helper: estima tokens totais dos chunks completed do agente
//
// Backlog #10 Auditoria (mai/2026): rodada 8 #3. Antes media bytes
// (content.length) e comparava com threshold em bytes. Agora estima
// tokens via heuristica chars/3 (PT-BR) — limite que realmente importa
// pra janela de contexto da OpenAI. Ver token-estimate.ts pra trade-off
// vs tiktoken.
// ----------------------------------------------------------------------------

async function measureKnowledgeTokens(
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
  return rows.reduce((sum, row) => sum + estimateTokens(row.content), 0);
}
