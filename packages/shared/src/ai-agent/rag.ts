// AI Agent — PR6 RAG contract.
//
// Retrieval-Augmented Generation for the agent knowledge base:
//   - Two source types under one schema: "faq" (Q&A pairs) and "document"
//     (uploaded PDF/DOCX/TXT in Supabase Storage).
//   - Embedding via Voyage AI (`voyage-3`, dim 1024). Sem Voyage key
//     → RAG silenciosamente off: indexing jobs marcam failed, retrieval
//     retorna vazio, executor cai direto no LLM sem contexto extra.
//   - Per-stage opt-in: `agent_stages.rag_enabled` + `rag_top_k` (1–10).
//
// Schema lives in migration 022. Runtime (Voyage client + chunker +
// indexer + retriever + executor hook) lives in `apps/crm/src/lib/ai-agent/rag/`
// and is owned by Codex in PR6.2.
//
// See CODEX_SYNC.md PR6 section for the full spec.

// ============================================================================
// Voyage AI — embedding model configuration (locked for PR6 ship)
// ============================================================================

// Changing the model = different dim = rebuild of every chunk. Do not
// adjust without a dedicated migration that re-embeds the corpus.
//
// IMPORTANT: voyage-3-lite is HARD-CODED at 512 dimensions and rejects
// `output_dimension: 1024` with HTTP 400 (descoberto em prod 2026-04-25).
// O schema usa vector(1024), entao usamos voyage-3 (default 1024,
// suporta 256/512/1024/2048). Pricing voyage-3 e ~9x voyage-3-lite
// ($0.18 vs $0.02 / 1M tokens) mas qualidade tambem e melhor.
export const VOYAGE_MODEL = "voyage-3" as const;
export const VOYAGE_DIM = 1024 as const;

// Voyage billing API accepts up to 128 inputs per request and caps at
// ~32k tokens per text. We keep a safer per-batch ceiling — embedder
// splits larger sources across multiple calls.
export const VOYAGE_BATCH_MAX = 128 as const;
export const VOYAGE_MAX_TOKENS_PER_INPUT = 16_000 as const;

// Voyage pricing (USD per 1M tokens). voyage-3 = $0.18/1M (vs $0.02 do
// lite). Mantem em sync com https://docs.voyageai.com/docs/pricing.
// Drift aqui afeta so telemetria, nao guardrails.
export const VOYAGE_PRICING_USD_PER_1M = 0.18 as const;

// Distinguishes the embedding mode Voyage uses internally. Retrieval
// quality is better when documents and queries pass different
// `input_type` values.
export type VoyageInputType = "document" | "query";

// ============================================================================
// Chunking strategy
// ============================================================================

// Chunk target size in tokens. Voyage-3-lite handles up to 16k per input,
// but smaller chunks yield better retrieval precision. 512 ~= ~2KB of text,
// comparable to typical LangChain/LlamaIndex defaults.
export const CHUNK_SIZE_TOKENS = 512 as const;

// Overlap keeps context across boundaries — a sentence split across two
// chunks still lands (partially) in both neighbors. Tune: 10–15% of chunk
// size is standard.
export const CHUNK_OVERLAP_TOKENS = 64 as const;

// Hard caps on a single source. Oversized documents are rejected at upload
// time with a clear error instead of silently truncating.
export const SOURCE_MAX_CHARS = 1_000_000 as const; // ~250k tokens
export const SOURCE_MAX_CHUNKS = 2_000 as const;

// Approx. char-per-token used when a tokenizer is not available. The
// runtime uses tiktoken-like counting when possible; this constant is the
// fallback for UI-side warnings ("documento grande demais").
export const CHUNK_CHAR_PER_TOKEN_APPROX = 4 as const;

// ============================================================================
// Retrieval knobs — per-stage, bounded at the type layer
// ============================================================================

export const RAG_TOP_K_DEFAULT = 3;
export const RAG_TOP_K_MIN = 1;
export const RAG_TOP_K_MAX = 10;

// Cosine distance threshold below which a chunk is considered irrelevant
// enough to skip injecting. pgvector returns distance in [0,2] for
// normalized embeddings; voyage-3-lite is unit-normalized, so values map
// roughly to 1 - cosine_similarity.
export const RAG_DISTANCE_CEILING = 0.75;

export function clampRagTopK(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return RAG_TOP_K_DEFAULT;
  return Math.max(RAG_TOP_K_MIN, Math.min(RAG_TOP_K_MAX, Math.round(value)));
}

// ============================================================================
// Document upload limits — enforced by the upload action
// ============================================================================

export const DOCUMENT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// MIME types the uploader accepts. Anything else is rejected at the UI
// layer — the runtime parser only implements these three.
export const DOCUMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "text/plain",
] as const;

export type DocumentMimeType = (typeof DOCUMENT_ALLOWED_MIME_TYPES)[number];

// Supabase Storage bucket for uploaded sources. Created out-of-band in
// the Supabase Dashboard during deploy — NOT by this migration (Storage
// buckets are a different subsystem). Private bucket, service_role-only.
export const KNOWLEDGE_STORAGE_BUCKET = "ai-agent-knowledge" as const;

// ============================================================================
// FAQ constraints
// ============================================================================

export const FAQ_QUESTION_MIN_CHARS = 3;
export const FAQ_QUESTION_MAX_CHARS = 500;
export const FAQ_ANSWER_MIN_CHARS = 3;
export const FAQ_ANSWER_MAX_CHARS = 5_000;

// ============================================================================
// Domain types — mirror agent_knowledge_sources / _chunks / _indexing_jobs
// ============================================================================

export type KnowledgeSourceType = "faq" | "document";

// Status of the parent source. "archived" hides from retrieval but keeps
// chunks for audit; a subsequent hard delete cascades to chunks+jobs.
export type KnowledgeSourceStatus = "active" | "archived";

// Lifecycle of the indexing work for a given source. Mirrors jobs.status
// plus a "pending" terminal right after creation when no job exists yet.
export type IndexingStatus = "pending" | "processing" | "indexed" | "failed";

// Per-source metadata shape. JSONB on the DB side; TS enforces the
// discriminated union so UI and runtime never need runtime parsing guards.
export type KnowledgeSourceMetadata =
  | {
      // source_type === "faq"
      question: string;
      answer: string;
    }
  | {
      // source_type === "document"
      storage_path: string;       // relative to KNOWLEDGE_STORAGE_BUCKET
      mime_type: DocumentMimeType;
      size_bytes: number;
      original_filename: string;
    };

export interface AgentKnowledgeSource {
  id: string;
  organization_id: string;
  config_id: string;
  source_type: KnowledgeSourceType;
  title: string;                    // user-visible, required
  metadata: KnowledgeSourceMetadata;
  status: KnowledgeSourceStatus;
  indexing_status: IndexingStatus;
  indexing_error: string | null;
  indexed_at: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface AgentKnowledgeChunk {
  id: string;
  source_id: string;
  organization_id: string;
  config_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  // embedding is write-only from the runtime's perspective. The UI never
  // needs to read the raw vector — retrieval is done by service_role SQL.
  created_at: string;
}

export type IndexingJobStatus = "pending" | "processing" | "done" | "failed";

export interface AgentIndexingJob {
  id: string;
  organization_id: string;
  source_id: string;
  status: IndexingJobStatus;
  attempts: number;
  claimed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Action input/output — used by server actions (CRUD) + runtime integrations
// ============================================================================

export interface CreateFAQInput {
  config_id: string;
  title: string;
  question: string;
  answer: string;
}

export interface UpdateFAQInput {
  title?: string;
  question?: string;
  answer?: string;
  status?: KnowledgeSourceStatus;
}

export interface CreateDocumentInput {
  config_id: string;
  title: string;
  storage_path: string;
  mime_type: DocumentMimeType;
  size_bytes: number;
  original_filename: string;
}

// What the retriever returns to the executor for prompt injection.
export interface RetrievalHit {
  chunk_id: string;
  source_id: string;
  source_type: KnowledgeSourceType;
  source_title: string;
  content: string;
  distance: number;                 // cosine distance [0,2]; lower = more similar
}

export interface RetrievalQuery {
  config_id: string;
  organization_id: string;
  query_text: string;
  top_k: number;
  // If true, the retriever logs the hit list into agent_steps under
  // step_type='llm' with a "retrieval" marker. Callers should pass true
  // for production runs and false for tester sheet previews to avoid
  // polluting audit history.
  audit: boolean;
}

// ============================================================================
// Audit step payloads — retrieval lands as a dedicated step before LLM
// ============================================================================

export interface RetrievalStepInput {
  query_text: string;
  top_k_requested: number;
  distance_ceiling: number;
}

export interface RetrievalStepOutput {
  success: boolean;
  hits_returned: number;
  tokens_embedded: number;          // query tokens sent to Voyage
  duration_ms: number;
  // When success=false, `error` carries the reason (missing key, API 5xx,
  // etc.). The executor degrades gracefully: no context block, but the
  // run continues with LLM-only answer.
  error?: string;
  // Top hits (id + title + distance only; content is NOT duplicated here
  // because it goes into the LLM prompt anyway and bloats the step row).
  hits?: ReadonlyArray<{
    source_id: string;
    source_title: string;
    distance: number;
  }>;
}

// ============================================================================
// Prompt template — how retrieved chunks get injected into the system prompt
// ============================================================================

// Runtime prepends this block before the agent's system_prompt when
// retrieval returns at least one hit below RAG_DISTANCE_CEILING. Kept
// here so UI previews (future tester sheet) show the exact wrapper.
export const RAG_CONTEXT_PREFIX = "Contexto relevante da base de conhecimento:";
export const RAG_CONTEXT_INSTRUCTIONS =
  "Use as informacoes abaixo para responder quando forem relevantes. Se a pergunta nao for coberta, responda normalmente sem inventar dados.";
