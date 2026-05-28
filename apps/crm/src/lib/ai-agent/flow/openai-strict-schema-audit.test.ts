import { describe, expect, it } from "vitest";
import { NATIVE_TOOL_PRESETS } from "@persia/shared/ai-agent";
import { auditOpenAIStrictToolSchema } from "./openai-strict-schema-audit";

describe("openai strict schema audit", () => {
  it("aprova schema strict completo", () => {
    const result = auditOpenAIStrictToolSchema({
      type: "object",
      additionalProperties: false,
      required: ["tag_name"],
      properties: {
        tag_name: {
          type: "string",
          description: "Tag name",
        },
      },
    });

    expect(result.compatibleWithStrict).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("detecta campos opcionais e additionalProperties ausente", () => {
    const result = auditOpenAIStrictToolSchema({
      type: "object",
      properties: {
        reason: { type: "string" },
      },
    });

    expect(result.compatibleWithStrict).toBe(false);
    expect(result.issues).toEqual([
      {
        path: "$",
        severity: "error",
        message:
          "Strict function schemas must set additionalProperties: false.",
      },
      {
        path: "$.reason",
        severity: "error",
        message:
          "Strict function schemas must require every declared property. Model optional fields as nullable before enabling strict.",
      },
    ]);
  });

  it("detecta required apontando para propriedade inexistente", () => {
    const result = auditOpenAIStrictToolSchema({
      type: "object",
      additionalProperties: false,
      required: ["missing"],
      properties: {},
    });

    expect(result.compatibleWithStrict).toBe(false);
    expect(result.issues).toEqual([
      {
        path: "$.missing",
        severity: "error",
        message: "Required field is not declared in properties.",
      },
    ]);
  });

  it("audita todos os presets nativos sem forcar strict=true ainda", () => {
    const audited = NATIVE_TOOL_PRESETS.map((preset) => ({
      name: preset.name,
      handler: preset.handler,
      result: auditOpenAIStrictToolSchema(preset.input_schema),
    }));

    const strictReady = audited.filter((entry) => entry.result.compatibleWithStrict);
    const strictBlocked = audited.filter((entry) => !entry.result.compatibleWithStrict);

    expect(audited).toHaveLength(20);
    expect(strictReady).toHaveLength(0);
    expect(strictBlocked).toHaveLength(20);

    for (const entry of strictBlocked) {
      expect(entry.result.issues).toContainEqual({
        path: "$",
        severity: "error",
        message:
          "Strict function schemas must set additionalProperties: false.",
      });
    }
  });
});
