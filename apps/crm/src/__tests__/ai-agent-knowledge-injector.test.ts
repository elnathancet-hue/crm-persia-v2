import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildKnowledgeBlock } from "@/lib/ai-agent/flow/knowledge-injector";
import { clearKnowledgeCache } from "@/lib/ai-agent/flow/knowledge-cache";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  logError: vi.fn(),
}));

// Mock Voyage embedQuery via retriever module — evita HTTP real
vi.mock("@/lib/ai-agent/rag/retriever", () => ({
  retrieveWithAttempt: vi.fn(),
}));

import { retrieveWithAttempt } from "@/lib/ai-agent/rag/retriever";

// Backlog #2 (mai/2026): cache de knowledge agora persiste entre
// chamadas — sem reset, testes da mesma chave (org-1+agent-1) leem
// resposta do teste anterior. beforeEach garante isolamento.
beforeEach(() => {
  clearKnowledgeCache();
});

/**
 * Mock builder simples — aceita chains arbitrários de eq/order/select
 * e devolve um resultado configurado pra cada combinação de table + ops.
 *
 * Usage:
 *   const db = makeDb({
 *     "agent_configs.maybeSingle": { knowledge_mode: "full" },
 *     "agent_knowledge_chunks": [{ content: "...", chunk_index: 0, source: { title: "FAQ" } }],
 *   });
 */
function makeDb(responses: Record<string, unknown>) {
  function builder(table: string, terminalKey?: string): unknown {
    const result =
      responses[`${table}.${terminalKey ?? "default"}`] ?? responses[table];
    const chain: Record<string, unknown> = {};
    const noopChain = [
      "select",
      "eq",
      "neq",
      "in",
      "order",
      "limit",
      "not",
      "or",
      "is",
      "gte",
      "lte",
    ];
    for (const op of noopChain) {
      chain[op] = () => chain;
    }
    chain.maybeSingle = () =>
      Promise.resolve({
        data: responses[`${table}.maybeSingle`] ?? null,
        error: null,
      });
    chain.single = () =>
      Promise.resolve({
        data: responses[`${table}.single`] ?? null,
        error: null,
      });
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: result ?? null, error: null }).then(resolve);
    return chain;
  }
  return { from: (table: string) => builder(table) } as never;
}

describe("buildKnowledgeBlock", () => {
  it("retorna null quando agente nao tem documento", async () => {
    const db = makeDb({
      "agent_configs.maybeSingle": { knowledge_mode: "full" },
      agent_knowledge_chunks: [], // zero chunks
    });

    const result = await buildKnowledgeBlock(db, "org-1", "agent-1", "oi");
    expect(result).toBeNull();
  });

  it("modo 'full' concatena chunks ordenados no bloco BASE DE CONHECIMENTO", async () => {
    const db = makeDb({
      "agent_configs.maybeSingle": { knowledge_mode: "full" },
      agent_knowledge_chunks: [
        { content: "Atendemos zona sul.", chunk_index: 0, source: { title: "FAQ" } },
        { content: "Taxa de 6%.", chunk_index: 1, source: { title: "FAQ" } },
      ],
    });

    const result = await buildKnowledgeBlock(db, "org-1", "agent-1", "qual a taxa?");

    expect(result).toContain("BASE DE CONHECIMENTO");
    expect(result).toContain("Atendemos zona sul.");
    expect(result).toContain("Taxa de 6%.");
    // Section title aparece
    expect(result).toContain("### FAQ");
  });

  it("modo 'rag' chama retriever e injeta top-k", async () => {
    vi.mocked(retrieveWithAttempt).mockResolvedValueOnce({
      success: true,
      hits: [
        {
          chunk_id: "c1",
          source_id: "s1",
          source_type: "document",
          source_title: "Proposta",
          content: "Item 1: descritivo.",
          distance: 0.2,
        },
        {
          chunk_id: "c2",
          source_id: "s1",
          source_type: "document",
          source_title: "Proposta",
          content: "Item 2: descritivo.",
          distance: 0.3,
        },
      ],
      tokensEmbedded: 50,
      durationMs: 200,
    });

    const db = makeDb({
      "agent_configs.maybeSingle": { knowledge_mode: "rag" },
    });

    const result = await buildKnowledgeBlock(
      db,
      "org-1",
      "agent-1",
      "quero saber sobre o produto",
    );

    expect(result).toContain("trechos relevantes pra essa pergunta");
    expect(result).toContain("Item 1");
    expect(result).toContain("Item 2");
    expect(result).toContain("Trecho 1");
    expect(result).toContain("Trecho 2");
    expect(retrieveWithAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        config_id: "agent-1",
        query_text: "quero saber sobre o produto",
        top_k: 3,
        audit: false,
      }),
      expect.anything(),
    );
  });

  it("modo 'rag' retorna null quando retriever falha", async () => {
    vi.mocked(retrieveWithAttempt).mockResolvedValueOnce({
      success: false,
      hits: [],
      tokensEmbedded: 0,
      durationMs: 100,
      error: "VOYAGE_API_KEY not set",
    });

    const db = makeDb({
      "agent_configs.maybeSingle": { knowledge_mode: "rag" },
    });

    const result = await buildKnowledgeBlock(db, "org-1", "agent-1", "pergunta");
    expect(result).toBeNull();
  });

  it("nunca quebra — retorna null quando schema esta fora", async () => {
    // db sem from() — força erro
    const dbBroken = { from: () => { throw new Error("schema broken"); } } as never;
    const result = await buildKnowledgeBlock(dbBroken, "org-1", "agent-1", "oi");
    expect(result).toBeNull();
  });

  it("modo default 'full' quando knowledge_mode for null/ausente", async () => {
    const db = makeDb({
      "agent_configs.maybeSingle": null, // sem coluna ainda (pre-migration 069)
      agent_knowledge_chunks: [
        { content: "Default content.", chunk_index: 0, source: { title: "Doc" } },
      ],
    });

    const result = await buildKnowledgeBlock(db, "org-1", "agent-1", "qual?");
    expect(result).toContain("BASE DE CONHECIMENTO");
    expect(result).toContain("Default content.");
  });

  it("PR-2: modo 'full' manual com doc grande > 50KB cai pra 'rag'", async () => {
    // Endereca rodada 6 #5 / rodada 8 #1: cliente forcando 'full' em UI
    // com doc enorme nao tem cap. Hard-cap unificado (50KB) derruba pra
    // rag automaticamente, evitando re-injetar 100KB+ a cada turn.
    vi.mocked(retrieveWithAttempt).mockResolvedValueOnce({
      success: true,
      hits: [
        {
          chunk_id: "c-rag",
          source_id: "s-big",
          source_type: "document",
          source_title: "BigDoc",
          content: "Trecho relevante extraido pelo RAG fallback.",
          distance: 0.15,
        },
      ],
      tokensEmbedded: 30,
      durationMs: 80,
    });

    // 60KB de conteudo simulado (acima do cap de 50KB)
    const bigContent = "x".repeat(60 * 1024);
    const db = makeDb({
      "agent_configs.maybeSingle": { knowledge_mode: "full" },
      agent_knowledge_chunks: [
        { content: bigContent, chunk_index: 0, source: { title: "BigDoc" } },
      ],
    });

    const result = await buildKnowledgeBlock(db, "org-1", "agent-1", "pergunta");

    // Deve ter caido pro rag — bloco e rotulado como "trechos relevantes"
    expect(result).toContain("trechos relevantes pra essa pergunta");
    expect(result).toContain("Trecho relevante extraido pelo RAG fallback.");
    // Conteudo gigantesco do full NAO foi injetado
    expect(result).not.toContain("xxxxxx");
    // Confirma que retriever foi chamado (fallback ativado)
    expect(retrieveWithAttempt).toHaveBeenCalled();
  });
});
