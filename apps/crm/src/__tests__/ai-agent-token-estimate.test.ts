// Backlog #10 Auditoria (mai/2026) — testes da heuristica estimateTokens
// + integracao com knowledge-injector.
//
// Endereca rodada 8 #3 do POST_CODEX_AUDIT_AGENT_FLOW_353.md. Antes,
// knowledge-injector decidia full vs rag por BYTES (30KB). Em PT-BR
// ~3 chars/token, 30KB ~= 10k tokens — alem da janela pratica do
// gpt-4o-mini. Agora threshold em tokens (6000 default, 16000 cap).

import { describe, expect, it } from "vitest";
import {
  CHARS_PER_TOKEN_PT_BR,
  estimateTokens,
  estimateTokensFromTexts,
} from "@persia/shared/ai-agent";

describe("Backlog #10: estimateTokens — heuristica chars/3 PT-BR", () => {
  it("texto vazio/null/undefined retorna 0", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it("3 chars equivale a 1 token", () => {
    expect(estimateTokens("abc")).toBe(1);
  });

  it("arredonda pra cima (Math.ceil)", () => {
    // 4 chars / 3 = 1.33 -> 2 tokens
    expect(estimateTokens("abcd")).toBe(2);
    // 5 chars / 3 = 1.67 -> 2 tokens
    expect(estimateTokens("abcde")).toBe(2);
    // 6 chars / 3 = 2 tokens exato
    expect(estimateTokens("abcdef")).toBe(2);
  });

  it("texto PT-BR longo: 300 chars ≈ 100 tokens", () => {
    const text = "a".repeat(300);
    expect(estimateTokens(text)).toBe(100);
  });

  it("CHARS_PER_TOKEN_PT_BR e 3", () => {
    expect(CHARS_PER_TOKEN_PT_BR).toBe(3);
  });
});

describe("Backlog #10: estimateTokensFromTexts — soma chunks", () => {
  it("array vazio retorna 0", () => {
    expect(estimateTokensFromTexts([])).toBe(0);
  });

  it("soma cada chunk individual (preserva precisao do ceil)", () => {
    // Note: estimateTokens arredonda CADA chunk pra cima, entao
    // [4 chars + 4 chars] = ceil(4/3) + ceil(4/3) = 2 + 2 = 4 tokens
    // (vs concatenar e estimar uma vez: ceil(8/3) = 3 tokens)
    expect(estimateTokensFromTexts(["abcd", "abcd"])).toBe(4);
  });

  it("null/undefined no array nao quebra", () => {
    expect(estimateTokensFromTexts(["abc", null, undefined, "abc"])).toBe(2);
  });

  it("doc grande: 60KB chars = ~20480 tokens", () => {
    const chunks = [
      "x".repeat(20 * 1024),
      "y".repeat(20 * 1024),
      "z".repeat(20 * 1024),
    ];
    const total = estimateTokensFromTexts(chunks);
    // 3 * ceil(20480 / 3) = 3 * 6827 = 20481
    expect(total).toBe(20481);
    // Acima do FULL_MODE_HARD_CAP_TOKENS (16000) — esperado disparar
    // fallback pra rag no knowledge-injector.
    expect(total).toBeGreaterThan(16000);
  });

  it("doc medio: 12KB chars = ~4096 tokens (abaixo do auto threshold)", () => {
    const chunks = ["x".repeat(12 * 1024)];
    const total = estimateTokensFromTexts(chunks);
    // ceil(12288 / 3) = 4096
    expect(total).toBe(4096);
    // Abaixo do AUTO_FULL_TOKEN_THRESHOLD (6000) — modo auto escolhe
    // full no knowledge-injector.
    expect(total).toBeLessThan(6000);
  });
});
