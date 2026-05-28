// Fix (mai/2026): override de `input_schema` no runner pra tools nativas.
//
// Após PR #381 deixar os presets shared strict-ready (additionalProperties:
// false + required completo + nullable explicito), runs em modo Responses
// passavam a falhar em prod porque `agent_tools.input_schema` (persistido
// no DB ANTES do PR #381) ficou com shape antigo. OpenAI strict rejeitava
// com 400 "additionalProperties is required to be supplied and to be false".
//
// Fix: pra tools nativas (`execution_mode='native'` + `native_handler`
// conhecido), runner pega o input_schema do preset shared. n8n_webhook +
// MCP continuam usando o input_schema do DB (não há preset shared
// correspondente).
//
// Este teste valida apenas o helper de resolução. O wire no runner é
// coberto pelo build typecheck (TS garante shape) + smoke test manual em
// staging.

import { describe, expect, it } from "vitest";
import { getPreset, NATIVE_TOOL_PRESETS } from "@persia/shared/ai-agent";

describe("native tool schema override (mai/2026, fix PR 5)", () => {
  it("emit_event preset tem additionalProperties:false (strict-ready)", () => {
    const preset = getPreset("emit_event");
    expect(preset).toBeDefined();
    expect(preset!.input_schema.additionalProperties).toBe(false);
  });

  it("emit_event preset tem required cobrindo todas as properties", () => {
    const preset = getPreset("emit_event");
    expect(preset).toBeDefined();
    const properties = Object.keys(preset!.input_schema.properties);
    const required = preset!.input_schema.required ?? [];
    for (const key of properties) {
      expect(required).toContain(key);
    }
  });

  it("todos os 20 presets nativos sao strict-ready", () => {
    // Espelha o teste de openai-strict-schema-audit mas explicito aqui pra
    // documentar que o override depende deste invariante.
    for (const preset of NATIVE_TOOL_PRESETS) {
      expect(
        preset.input_schema.additionalProperties,
        `preset ${preset.name} sem additionalProperties: false`,
      ).toBe(false);

      const properties = Object.keys(preset.input_schema.properties);
      const required = preset.input_schema.required ?? [];
      for (const key of properties) {
        expect(
          required,
          `preset ${preset.name} property "${key}" nao esta em required`,
        ).toContain(key);
      }
    }
  });

  it("getPreset retorna undefined pra handler desconhecido (fallback pro DB)", () => {
    // @ts-expect-error — handler inválido testado de propósito
    expect(getPreset("handler_inexistente")).toBeUndefined();
  });
});
