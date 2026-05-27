// Backlog #2 Auditoria (mai/2026) — testes do knowledge cache.
//
// Endereca rodada 6 #5 + rodada 8 #1 do POST_CODEX_AUDIT_AGENT_FLOW_353.md.
// Cache em memoria por process, invalidado por sources_hash automatico.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  clearKnowledgeCache,
  getCachedBlock,
  getKnowledgeCacheSize,
  setCachedBlock,
} from "@/lib/ai-agent/flow/knowledge-cache";

describe("Backlog #2: knowledge-cache helpers", () => {
  beforeEach(() => {
    clearKnowledgeCache();
  });

  it("undefined em cache vazio", () => {
    expect(getCachedBlock("full:org-1:agent-1", "h1")).toBeUndefined();
  });

  it("set + get retorna o bloco quando hash bate e age < TTL", () => {
    setCachedBlock("full:org-1:agent-1", "bloco-de-conhecimento", "h1", 1000);
    expect(getCachedBlock("full:org-1:agent-1", "h1", 1000)).toBe(
      "bloco-de-conhecimento",
    );
  });

  it("hit valido pra bloco null (sem chunks) — cache distingue null vs undefined", () => {
    setCachedBlock("full:org-1:agent-1", null, "h-empty", 1000);
    expect(getCachedBlock("full:org-1:agent-1", "h-empty", 1000)).toBeNull();
  });

  it("miss quando sources_hash mudou (admin uplodou nova source)", () => {
    setCachedBlock("full:org-1:agent-1", "bloco-v1", "hash-antigo", 1000);
    // Caller agora detecta novo hash (source nova indexed)
    const result = getCachedBlock("full:org-1:agent-1", "hash-novo", 1000);
    expect(result).toBeUndefined();
    // Cache foi invalidado — entry removida
    expect(getKnowledgeCacheSize()).toBe(0);
  });

  it("miss quando age > TTL (15min)", () => {
    setCachedBlock("full:org-1:agent-1", "bloco", "h1", 0);
    // 16min depois (1ms apos TTL de 15min = 900000ms)
    const result = getCachedBlock("full:org-1:agent-1", "h1", 15 * 60 * 1000 + 1);
    expect(result).toBeUndefined();
    expect(getKnowledgeCacheSize()).toBe(0);
  });

  it("isolamento por chave: config_id diferente nao colide", () => {
    setCachedBlock("full:org-1:agent-A", "bloco-A", "h1", 1000);
    setCachedBlock("full:org-1:agent-B", "bloco-B", "h1", 1000);
    expect(getCachedBlock("full:org-1:agent-A", "h1", 1000)).toBe("bloco-A");
    expect(getCachedBlock("full:org-1:agent-B", "h1", 1000)).toBe("bloco-B");
    expect(getKnowledgeCacheSize()).toBe(2);
  });

  it("isolamento por org: orgs diferentes nao compartilham", () => {
    setCachedBlock("full:org-A:agent-1", "bloco-A", "h1", 1000);
    setCachedBlock("full:org-B:agent-1", "bloco-B", "h1", 1000);
    expect(getCachedBlock("full:org-A:agent-1", "h1", 1000)).toBe("bloco-A");
    expect(getCachedBlock("full:org-B:agent-1", "h1", 1000)).toBe("bloco-B");
  });

  it("clearKnowledgeCache esvazia completamente", () => {
    setCachedBlock("full:org-1:agent-1", "x", "h1", 1000);
    setCachedBlock("full:org-2:agent-1", "y", "h1", 1000);
    expect(getKnowledgeCacheSize()).toBe(2);
    clearKnowledgeCache();
    expect(getKnowledgeCacheSize()).toBe(0);
    expect(getCachedBlock("full:org-1:agent-1", "h1", 1000)).toBeUndefined();
  });

  it("set sobrescreve entrada existente (mesma chave, bloco novo)", () => {
    setCachedBlock("full:org-1:agent-1", "v1", "h1", 1000);
    setCachedBlock("full:org-1:agent-1", "v2", "h2", 2000);
    expect(getCachedBlock("full:org-1:agent-1", "h2", 2000)).toBe("v2");
    // Hash antigo nao bate mais
    expect(getCachedBlock("full:org-1:agent-1", "h1", 2000)).toBeUndefined();
  });
});
