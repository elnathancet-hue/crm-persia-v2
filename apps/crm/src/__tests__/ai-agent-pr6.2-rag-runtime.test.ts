import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  getRequestId: vi.fn(() => "req-rag"),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const openaiMock = vi.hoisted(() => ({
  chat: { completions: { create: vi.fn() } },
}));

const createAdminClientMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: vi.fn(() => openaiMock),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import type {
  AgentConfig,
  AgentConversation,
  AgentStage,
} from "@persia/shared/ai-agent";
import {
  KNOWLEDGE_STORAGE_BUCKET,
  RAG_CONTEXT_PREFIX,
  SOURCE_MAX_CHARS,
} from "@persia/shared/ai-agent";
import { asAgentDb } from "@/lib/ai-agent/db";
import { executeAgent } from "@/lib/ai-agent/executor";
import { chunkText, SourceTooLargeError } from "@/lib/ai-agent/rag/chunker";
import { runIndexingTick } from "@/lib/ai-agent/rag/indexer";
import { retrieveWithAttempt } from "@/lib/ai-agent/rag/retriever";

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "config-a",
    organization_id: "org-a",
    name: "Recepcao",
    description: null,
    scope_type: "global",
    scope_id: null,
    model: "gpt-5-mini",
    system_prompt: "Voce atende clientes.",
    guardrails: {
      max_iterations: 5,
      timeout_seconds: 30,
      cost_ceiling_tokens: 20_000,
      allow_human_handoff: true,
    },
    debounce_window_ms: 10000,
    context_summary_turn_threshold: 10,
    context_summary_token_threshold: 20000,
    context_summary_recent_messages: 6,
    status: "active",
    created_at: "2026-04-24T00:00:00.000Z",
    updated_at: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

function stage(overrides: Partial<AgentStage> = {}): AgentStage {
  return {
    id: "stage-a",
    config_id: "config-a",
    organization_id: "org-a",
    slug: "inicio",
    order_index: 0,
    situation: "Inicio",
    instruction: "Cumprimente o cliente.",
    transition_hint: null,
    rag_enabled: false,
    rag_top_k: 3,
    created_at: "2026-04-24T00:00:00.000Z",
    updated_at: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

function conversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: "agent-conv-a",
    organization_id: "org-a",
    crm_conversation_id: "crm-conv-a",
    lead_id: "lead-a",
    config_id: "config-a",
    current_stage_id: "stage-a",
    history_summary: null,
    history_summary_updated_at: null,
    history_summary_run_count: 0,
    history_summary_token_count: 0,
    variables: {},
    tokens_used_total: 0,
    last_interaction_at: null,
    created_at: "2026-04-24T00:00:00.000Z",
    updated_at: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

// Gera embedding com VOYAGE_DIM (1024) dimensoes — necessario porque
// voyage-client.ts valida que vec.length === VOYAGE_DIM e throw
// "Voyage retornou dim X, esperado 1024" se nao bater. Os valores
// passados (head) ficam no inicio, resto e zero (irrelevante pra
// retrieval — distance e calculada server-side via pgvector). Helper
// adicionado quando trocamos voyage-3-lite (512) por voyage-3 (1024)
// nativo no PR #57.
function mockEmbedding(head: number[]): number[] {
  const VOYAGE_DIM = 1024;
  if (head.length >= VOYAGE_DIM) return head.slice(0, VOYAGE_DIM);
  return [...head, ...Array<number>(VOYAGE_DIM - head.length).fill(0)];
}

describe("ai-agent PR6.2 rag runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "openai-test-key";
    process.env.VOYAGE_API_KEY = "voyage-test-key";
    global.fetch = vi.fn();
  });

  it("chunkText returns empty for blank input and preserves long multi-paragraph content", () => {
    expect(chunkText("   \n\n   ")).toEqual([]);

    const content = [
      "Primeiro paragrafo curto.",
      "",
      "Segundo paragrafo com bastante contexto ".repeat(120),
    ].join("\n");
    const chunks = chunkText(content);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.content).toContain("Primeiro paragrafo curto");
  });

  it("chunkText rejects oversized sources", () => {
    expect(() => chunkText("a".repeat(SOURCE_MAX_CHARS + 1))).toThrow(SourceTooLargeError);
  });

  it("retrieveWithAttempt returns a soft failure when VOYAGE_API_KEY is missing", async () => {
    delete process.env.VOYAGE_API_KEY;
    const supabase = createSupabaseMock();

    const result = await retrieveWithAttempt({
      config_id: "config-a",
      organization_id: "org-a",
      query_text: "quero saber horarios",
      top_k: 3,
      audit: true,
    }, asAgentDb(supabase as never));

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        hits: [],
        tokensEmbedded: 0,
        error: "VOYAGE_API_KEY not set",
      }),
    );
    expect(supabase.rpcCalls).toEqual([]);
  });

  it("retrieveWithAttempt filters out chunks above the distance ceiling and keeps org scoping", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("rpc:match_agent_knowledge_chunks", {
      data: [
        {
          chunk_id: "chunk-a",
          source_id: "source-a",
          source_type: "faq",
          source_title: "FAQ Comercial",
          content: "Atendemos de segunda a sexta.",
          distance: 0.21,
        },
        {
          chunk_id: "chunk-b",
          source_id: "source-b",
          source_type: "document",
          source_title: "Politica Interna",
          content: "Nao deve aparecer.",
          distance: 0.92,
        },
      ],
      error: null,
    });
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: [{ embedding: mockEmbedding([0.11, 0.22, 0.33]) }],
        usage: { total_tokens: 12 },
      }),
    );

    const result = await retrieveWithAttempt({
      config_id: "config-a",
      organization_id: "org-a",
      query_text: "qual o horario?",
      top_k: 3,
      audit: true,
    }, asAgentDb(supabase as never));

    expect(result.success).toBe(true);
    expect(result.tokensEmbedded).toBe(12);
    expect(result.hits).toEqual([
      expect.objectContaining({
        chunk_id: "chunk-a",
        source_id: "source-a",
        source_title: "FAQ Comercial",
      }),
    ]);
    expect(supabase.rpcCalls[0]).toMatchObject({
      fn: "match_agent_knowledge_chunks",
      args: expect.objectContaining({
        p_organization_id: "org-a",
        p_config_id: "config-a",
        p_top_k: 3,
      }),
    });
  });

  it("runIndexingTick indexes a TXT document and writes chunks through the RPC", async () => {
    const supabase = createSupabaseMock();
    createAdminClientMock.mockReturnValue(supabase as never);
    supabase.queue("rpc:claim_agent_indexing_job", {
      data: [{
        id: "job-a",
        organization_id: "org-a",
        source_id: "source-a",
        status: "processing",
        attempts: 1,
        claimed_at: "2026-04-24T00:00:00.000Z",
        error_message: null,
        created_at: "2026-04-24T00:00:00.000Z",
        updated_at: "2026-04-24T00:00:00.000Z",
      }],
      error: null,
    });
    supabase.queue("agent_knowledge_sources", {
      data: null,
      error: null,
    });
    supabase.queue("agent_knowledge_sources", {
      data: {
        id: "source-a",
        organization_id: "org-a",
        config_id: "config-a",
        source_type: "document",
        title: "Manual",
        metadata: {
          storage_path: "org-a/config-a/manual.txt",
          mime_type: "text/plain",
          size_bytes: 120,
          original_filename: "manual.txt",
        },
        status: "active",
        indexing_status: "processing",
        indexing_error: null,
        indexed_at: null,
        chunk_count: 0,
        created_at: "2026-04-24T00:00:00.000Z",
        updated_at: "2026-04-24T00:00:00.000Z",
      },
      error: null,
    });
    supabase.queueStorageDownload(
      KNOWLEDGE_STORAGE_BUCKET,
      "org-a/config-a/manual.txt",
      {
        data: {
          arrayBuffer: async () =>
            new TextEncoder().encode("Linha um.\n\nLinha dois com contexto.").buffer,
        },
        error: null,
      },
    );
    supabase.queue("rpc:complete_agent_indexing_job", {
      data: 1,
      error: null,
    });
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: [{ embedding: mockEmbedding([0.1, 0.2, 0.3]) }],
        usage: { total_tokens: 18 },
      }),
    );

    const result = await runIndexingTick(asAgentDb(supabase as never));

    expect(result).toEqual(
      expect.objectContaining({
        claimed_job_id: "job-a",
        indexed_sources: 1,
        failed_jobs: 0,
      }),
    );
    expect(supabase.rpcCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fn: "claim_agent_indexing_job" }),
        expect.objectContaining({
          fn: "complete_agent_indexing_job",
          args: expect.objectContaining({
            p_job_id: "job-a",
            p_source_id: "source-a",
            p_organization_id: "org-a",
            p_config_id: "config-a",
            p_chunks: expect.any(Array),
          }),
        }),
      ]),
    );
  });

  it("runIndexingTick marks the job as failed when Voyage is unavailable", async () => {
    delete process.env.VOYAGE_API_KEY;
    const supabase = createSupabaseMock();
    createAdminClientMock.mockReturnValue(supabase as never);
    supabase.queue("rpc:claim_agent_indexing_job", {
      data: [{
        id: "job-a",
        organization_id: "org-a",
        source_id: "source-faq",
        status: "processing",
        attempts: 1,
        claimed_at: "2026-04-24T00:00:00.000Z",
        error_message: null,
        created_at: "2026-04-24T00:00:00.000Z",
        updated_at: "2026-04-24T00:00:00.000Z",
      }],
      error: null,
    });
    supabase.queue("agent_knowledge_sources", {
      data: null,
      error: null,
    });
    supabase.queue("agent_knowledge_sources", {
      data: {
        id: "source-faq",
        organization_id: "org-a",
        config_id: "config-a",
        source_type: "faq",
        title: "FAQ",
        metadata: {
          question: "Qual horario?",
          answer: "Das 9h as 18h.",
        },
        status: "active",
        indexing_status: "processing",
        indexing_error: null,
        indexed_at: null,
        chunk_count: 0,
        created_at: "2026-04-24T00:00:00.000Z",
        updated_at: "2026-04-24T00:00:00.000Z",
      },
      error: null,
    });
    supabase.queue("rpc:fail_agent_indexing_job", {
      data: true,
      error: null,
    });

    const result = await runIndexingTick(asAgentDb(supabase as never));

    expect(result.failed_jobs).toBe(1);
    expect(supabase.rpcCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fn: "fail_agent_indexing_job",
          args: expect.objectContaining({
            p_job_id: "job-a",
            p_error_message: "VOYAGE_API_KEY not set",
          }),
        }),
      ]),
    );
  });

  it("runIndexingTick marks the source as processing as soon as a job is claimed", async () => {
    const supabase = createSupabaseMock();
    createAdminClientMock.mockReturnValue(supabase as never);
    supabase.queue("rpc:claim_agent_indexing_job", {
      data: [{
        id: "job-processing",
        organization_id: "org-a",
        source_id: "source-processing",
        status: "processing",
        attempts: 1,
        claimed_at: "2026-04-24T00:00:00.000Z",
        error_message: null,
        created_at: "2026-04-24T00:00:00.000Z",
        updated_at: "2026-04-24T00:00:00.000Z",
      }],
      error: null,
    });
    supabase.queue("agent_knowledge_sources", {
      data: null,
      error: null,
    });
    supabase.queue("agent_knowledge_sources", {
      data: {
        id: "source-processing",
        organization_id: "org-a",
        config_id: "config-a",
        source_type: "faq",
        title: "FAQ",
        metadata: {
          question: "Qual horario?",
          answer: "Das 9h as 18h.",
        },
        status: "active",
        indexing_status: "processing",
        indexing_error: null,
        indexed_at: null,
        chunk_count: 0,
        created_at: "2026-04-24T00:00:00.000Z",
        updated_at: "2026-04-24T00:00:00.000Z",
      },
      error: null,
    });
    supabase.queue("rpc:complete_agent_indexing_job", {
      data: 1,
      error: null,
    });
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: [{ embedding: mockEmbedding([0.1, 0.2, 0.3]) }],
        usage: { total_tokens: 18 },
      }),
    );

    await runIndexingTick(asAgentDb(supabase as never));

    expect(supabase.updates.agent_knowledge_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexing_status: "processing",
          indexing_error: null,
        }),
      ]),
    );
  });

  it("runIndexingTick falls back to direct updates when fail RPC returns an error", async () => {
    delete process.env.VOYAGE_API_KEY;
    const supabase = createSupabaseMock();
    createAdminClientMock.mockReturnValue(supabase as never);
    supabase.queue("rpc:claim_agent_indexing_job", {
      data: [{
        id: "job-fail-fallback",
        organization_id: "org-a",
        source_id: "source-fail-fallback",
        status: "processing",
        attempts: 1,
        claimed_at: "2026-04-24T00:00:00.000Z",
        error_message: null,
        created_at: "2026-04-24T00:00:00.000Z",
        updated_at: "2026-04-24T00:00:00.000Z",
      }],
      error: null,
    });
    supabase.queue("agent_knowledge_sources", {
      data: null,
      error: null,
    });
    supabase.queue("agent_knowledge_sources", {
      data: {
        id: "source-fail-fallback",
        organization_id: "org-a",
        config_id: "config-a",
        source_type: "faq",
        title: "FAQ",
        metadata: {
          question: "Qual horario?",
          answer: "Das 9h as 18h.",
        },
        status: "active",
        indexing_status: "processing",
        indexing_error: null,
        indexed_at: null,
        chunk_count: 0,
        created_at: "2026-04-24T00:00:00.000Z",
        updated_at: "2026-04-24T00:00:00.000Z",
      },
      error: null,
    });
    supabase.queue("rpc:fail_agent_indexing_job", {
      data: null,
      error: { message: "rpc failed" },
    });

    await runIndexingTick(asAgentDb(supabase as never));

    expect(supabase.updates.agent_indexing_jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          error_message: "VOYAGE_API_KEY not set",
        }),
      ]),
    );
    expect(supabase.updates.agent_knowledge_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexing_status: "failed",
          indexing_error: "VOYAGE_API_KEY not set",
        }),
      ]),
    );
  });

  it("runIndexingTick converts exhausted pending jobs into failed before returning idle", async () => {
    const supabase = createSupabaseMock();
    createAdminClientMock.mockReturnValue(supabase as never);
    supabase.queue("agent_indexing_jobs", {
      data: [{
        id: "job-exhausted",
        organization_id: "org-a",
        source_id: "source-exhausted",
        status: "pending",
        attempts: 3,
        claimed_at: null,
      }],
      error: null,
    });
    supabase.queue("rpc:claim_agent_indexing_job", {
      data: [],
      error: null,
    });

    const result = await runIndexingTick(asAgentDb(supabase as never));

    expect(result.claimed_job_id).toBeNull();
    expect(supabase.updates.agent_indexing_jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          error_message: "max attempts reached",
        }),
      ]),
    );
    expect(supabase.updates.agent_knowledge_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexing_status: "failed",
          indexing_error: "max attempts reached",
        }),
      ]),
    );
  });

  it("runIndexingTick auto-requeues sources whose error matches a transient pattern", async () => {
    const supabase = createSupabaseMock();
    createAdminClientMock.mockReturnValue(supabase as never);

    // normalizeExhaustedJobs: nenhum job esgotado
    supabase.queue("agent_indexing_jobs", { data: [], error: null });

    // requeueTransientFailures: 2 sources failed por motivos diferentes —
    // uma transient (Voyage 400 do dim mismatch antigo), uma definitiva
    // (PDF corrompido). So a transient deve ser re-enfileirada.
    const oldUpdatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    supabase.queue("agent_knowledge_sources", {
      data: [
        {
          id: "source-transient",
          organization_id: "org-a",
          indexing_error: "Voyage request failed with status 400",
          updated_at: oldUpdatedAt,
        },
        {
          id: "source-definitive",
          organization_id: "org-a",
          indexing_error: "OPENAI_API_KEY is not configured",
          updated_at: oldUpdatedAt,
        },
      ],
      error: null,
    });
    // Update das sources transient pra pending
    supabase.queue("agent_knowledge_sources", { data: null, error: null });
    // Insert dos jobs novos
    supabase.queue("agent_indexing_jobs", { data: null, error: null });

    // claim retorna nada (sem job pra processar agora)
    supabase.queue("rpc:claim_agent_indexing_job", { data: [], error: null });

    const result = await runIndexingTick(asAgentDb(supabase as never));

    expect(result.claimed_job_id).toBeNull();

    // Apenas a source transient teve update pending + job novo.
    const sourcePendingUpdates = (supabase.updates.agent_knowledge_sources ?? []).filter(
      (row) => (row as { indexing_status?: string }).indexing_status === "pending",
    );
    expect(sourcePendingUpdates).toHaveLength(1);

    // Mock guarda batch insert como [ [item1, item2] ] (1 chamada =
    // 1 elemento no array, mesmo que o argumento seja array de N items).
    // Por isso achatamos antes de validar.
    const newJobs = (supabase.inserts.agent_indexing_jobs ?? []).flat();
    expect(newJobs).toHaveLength(1);
    expect(newJobs[0]).toMatchObject({
      source_id: "source-transient",
      organization_id: "org-a",
      status: "pending",
      attempts: 0,
    });
  });

  it("runIndexingTick does NOT auto-requeue sources whose error is definitive", async () => {
    const supabase = createSupabaseMock();
    createAdminClientMock.mockReturnValue(supabase as never);

    supabase.queue("agent_indexing_jobs", { data: [], error: null });

    // So source com erro definitivo (max attempts esgotados).
    supabase.queue("agent_knowledge_sources", {
      data: [
        {
          id: "source-exhausted",
          organization_id: "org-a",
          indexing_error: "max attempts reached",
          updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
      ],
      error: null,
    });

    supabase.queue("rpc:claim_agent_indexing_job", { data: [], error: null });

    const result = await runIndexingTick(asAgentDb(supabase as never));

    expect(result.claimed_job_id).toBeNull();
    // Nada de update pending — source fica como estava.
    const sourcePendingUpdates = (supabase.updates.agent_knowledge_sources ?? []).filter(
      (row) => (row as { indexing_status?: string }).indexing_status === "pending",
    );
    expect(sourcePendingUpdates).toHaveLength(0);
    // Nenhum job novo.
    expect(supabase.inserts.agent_indexing_jobs ?? []).toHaveLength(0);
  });

  it("executeAgent skips retrieval entirely when rag_enabled is false", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });
    supabase.queue("messages", { data: [], error: null });
    supabase.queue("agent_conversations", {
      data: { tokens_used_total: 0, variables: {} },
      error: null,
    });
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "Tudo certo." } }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });

    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      dryRun: true,
      config: config(),
      stage: stage({ rag_enabled: false }),
      agentConversation: conversation(),
      tools: [],
      inboundMessageId: "msg-a",
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      allowSummarization: false,
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("succeeded");
    expect(global.fetch).not.toHaveBeenCalled();
    const firstCall = openaiMock.chat.completions.create.mock.calls[0][0];
    expect(firstCall.messages[0].content).not.toContain(RAG_CONTEXT_PREFIX);
  });

  it("executeAgent injects retrieved context into the system prompt and audits retrieval", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });
    supabase.queue("messages", { data: [], error: null });
    supabase.queue("rpc:match_agent_knowledge_chunks", {
      data: [{
        chunk_id: "chunk-a",
        source_id: "source-a",
        source_type: "faq",
        source_title: "FAQ Comercial",
        content: "Atendemos de segunda a sexta, das 9h as 18h.",
        distance: 0.12,
      }],
      error: null,
    });
    supabase.queue("agent_conversations", {
      data: { tokens_used_total: 0, variables: {} },
      error: null,
    });
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: [{ embedding: mockEmbedding([0.4, 0.5, 0.6]) }],
        usage: { total_tokens: 9 },
      }),
    );
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "Nosso horario e comercial." } }],
      usage: { prompt_tokens: 40, completion_tokens: 12 },
    });

    const provider = { sendText: vi.fn(async () => ({ ok: true })) };
    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      provider: provider as never,
      dryRun: false,
      config: config(),
      stage: stage({ rag_enabled: true, rag_top_k: 5 }),
      agentConversation: conversation({
        history_summary: "Lead perguntando sobre horario.",
      }),
      tools: [],
      inboundMessageId: "msg-a",
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      allowSummarization: false,
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "qual o horario de atendimento?",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("succeeded");
    const firstCall = openaiMock.chat.completions.create.mock.calls[0][0];
    expect(firstCall.messages[0].content).toContain(RAG_CONTEXT_PREFIX);
    expect(firstCall.messages[0].content).toContain("FAQ Comercial");
    expect(firstCall.messages[0].content).toContain("Atendemos de segunda a sexta");
    expect(supabase.inserts.agent_steps[0]).toMatchObject({
      step_type: "llm",
      output: expect.objectContaining({
        phase: "retrieval",
        success: true,
        hits_returned: 1,
        tokens_embedded: 9,
      }),
    });
    expect(provider.sendText).toHaveBeenCalledWith({
      phone: "5511999990000",
      message: "Nosso horario e comercial.",
    });
  });

  it("executeAgent keeps the prompt unchanged and records a soft retrieval failure", async () => {
    delete process.env.VOYAGE_API_KEY;
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });
    supabase.queue("messages", { data: [], error: null });
    supabase.queue("agent_conversations", {
      data: { tokens_used_total: 0, variables: {} },
      error: null,
    });
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "Posso te ajudar com isso." } }],
      usage: { prompt_tokens: 25, completion_tokens: 8 },
    });

    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      provider: { sendText: vi.fn(async () => ({ ok: true })) } as never,
      dryRun: false,
      config: config(),
      stage: stage({ rag_enabled: true }),
      agentConversation: conversation(),
      tools: [],
      inboundMessageId: "msg-a",
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      allowSummarization: false,
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("succeeded");
    const firstCall = openaiMock.chat.completions.create.mock.calls[0][0];
    expect(firstCall.messages[0].content).not.toContain(RAG_CONTEXT_PREFIX);
    expect(supabase.inserts.agent_steps[0]).toMatchObject({
      step_type: "llm",
      output: expect.objectContaining({
        phase: "retrieval",
        success: false,
        error: "VOYAGE_API_KEY not set",
      }),
    });
  });

  it("migration 022 stays additive and includes the lease + retrieval functions", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/022_ai_agent_rag.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS vector;");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS rag_top_k INTEGER NOT NULL DEFAULT 3");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.claim_agent_indexing_job");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.complete_agent_indexing_job");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.match_agent_knowledge_chunks");
    expect(sql).toContain("ai-agent-indexer-tick");
  });

  it("migration 024 hardens the claim flow and raises the cron timeout", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/024_ai_agent_rag_indexer_hardening.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("indexing_status = 'processing'");
    expect(sql).toContain("error_message = coalesce(error_message, 'max attempts reached')");
    expect(sql).toContain("timeout_milliseconds := 60000");
  });
});
