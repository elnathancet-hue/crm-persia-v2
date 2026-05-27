// Backlog #14 Auditoria (mai/2026) — testes do match fuzzy de
// pause/resume keywords (rodada 7 #5).
//
// Antes: igualdade exata depois de uppercase+trim — "pausar" so batia
// se lead escrevesse literalmente "pausar" isolado. Frases reais
// ("pausar por favor", "STOP IA agora", "humanó") nao disparavam.
//
// Agora: normalizeKeyword tambem remove acentos + match por word
// boundary regex. False positives explicitos ("nao pausar" dispara
// PAUSAR) aceitos por simplicidade V1.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  matchesPauseKeyword,
  matchesResumeKeyword,
  normalizeHumanizationConfig,
  normalizeKeyword,
} from "@persia/shared/ai-agent";

// Reusa defaults conhecidos: PAUSE = ["PAUSAR", "HUMANO", "STOP IA"],
// RESUME = ["ATIVAR", "IA ON", "VOLTAR IA"].
const config = normalizeHumanizationConfig({});

describe("Backlog #14: normalizeKeyword remove acentos", () => {
  it("uppercase + trim continua funcionando", () => {
    expect(normalizeKeyword("  pausar  ")).toBe("PAUSAR");
  });

  it("remove acentos comuns", () => {
    expect(normalizeKeyword("paú")).toBe("PAU");
    expect(normalizeKeyword("humanó")).toBe("HUMANO");
    expect(normalizeKeyword("átivar")).toBe("ATIVAR");
  });

  it("preserva texto sem acentos", () => {
    expect(normalizeKeyword("PAUSAR")).toBe("PAUSAR");
  });
});

describe("Backlog #14: matchesPauseKeyword com word boundary", () => {
  it("frase contendo keyword como palavra isolada dispara", () => {
    expect(matchesPauseKeyword("pausar por favor", config)).toBe(true);
    expect(matchesPauseKeyword("preciso falar com humano agora", config)).toBe(true);
  });

  it("keyword case-insensitive + sem acento", () => {
    expect(matchesPauseKeyword("HUMANO", config)).toBe(true);
    expect(matchesPauseKeyword("humanó", config)).toBe(true);
  });

  it("multi-palavra 'STOP IA' bate apenas como sequencia", () => {
    expect(matchesPauseKeyword("stop ia agora", config)).toBe(true);
    expect(matchesPauseKeyword("STOP IA", config)).toBe(true);
    // "stop" sozinho nao dispara (preserva configs explicitos)
    expect(matchesPauseKeyword("stop", config)).toBe(false);
  });

  it("keyword embutido em outra palavra NAO dispara (word boundary)", () => {
    // "pausarento" tem PAUSAR como substring mas nao palavra isolada
    expect(matchesPauseKeyword("pausarento", config)).toBe(false);
    expect(matchesPauseKeyword("humanoide", config)).toBe(false);
  });

  it("false positive explicito: 'nao pausar' dispara (V1 trade-off)", () => {
    // Trade-off aceito no plano — preferimos disparar pause em mais
    // casos do que perder intenção real do lead.
    expect(matchesPauseKeyword("nao pausar agora", config)).toBe(true);
  });

  it("texto sem keyword nao dispara", () => {
    expect(matchesPauseKeyword("oi tudo bem?", config)).toBe(false);
    expect(matchesPauseKeyword("preciso de ajuda", config)).toBe(false);
  });

  it("texto null/empty nao dispara", () => {
    expect(matchesPauseKeyword(null, config)).toBe(false);
    expect(matchesPauseKeyword(undefined, config)).toBe(false);
    expect(matchesPauseKeyword("", config)).toBe(false);
  });
});

describe("Backlog #14: matchesResumeKeyword com word boundary", () => {
  it("ATIVAR dispara em frase", () => {
    expect(matchesResumeKeyword("ativar de novo a IA", config)).toBe(true);
  });

  it("'IA ON' sequencia bate; 'IA' sozinho nao", () => {
    expect(matchesResumeKeyword("ia on por favor", config)).toBe(true);
    expect(matchesResumeKeyword("ia", config)).toBe(false);
  });

  it("'VOLTAR IA' com acentos no lead", () => {
    expect(matchesResumeKeyword("volta'r ia agora", config)).toBe(false); // apostrofe quebra word
    expect(matchesResumeKeyword("voltar ia agora", config)).toBe(true);
  });

  it("texto vazio nao dispara", () => {
    expect(matchesResumeKeyword("", config)).toBe(false);
    expect(matchesResumeKeyword(null, config)).toBe(false);
  });
});
