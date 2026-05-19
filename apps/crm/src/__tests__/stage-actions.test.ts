import { describe, expect, it } from "vitest";
import {
  hasActionsBeenExecuted,
  markActionsExecuted,
  normalizeActionsExecuted,
  normalizeStageActionConfig,
  sanitizeStageAutoAction,
  STAGE_AUTO_ACTION_TYPES,
} from "@persia/shared/ai-agent";

describe("stage-actions", () => {
  describe("normalizeStageActionConfig", () => {
    it("retorna default vazio quando raw e null/undefined/invalido", () => {
      expect(normalizeStageActionConfig(null).auto_actions).toEqual([]);
      expect(normalizeStageActionConfig(undefined).auto_actions).toEqual([]);
      expect(normalizeStageActionConfig("not-an-object").auto_actions).toEqual([]);
      expect(normalizeStageActionConfig([]).auto_actions).toEqual([]);
    });

    it("aceita objeto sem auto_actions (default vazio)", () => {
      expect(normalizeStageActionConfig({}).auto_actions).toEqual([]);
    });

    it("descarta acoes invalidas silenciosamente, preserva validas", () => {
      const result = normalizeStageActionConfig({
        auto_actions: [
          { type: "add_tag", tag_name: "qualificado" }, // valida
          { type: "tipo-inexistente" }, // descartada
          { type: "add_tag" }, // descartada (sem tag_name)
          { type: "send_media", slug: "catalogo-pdf" }, // valida
        ],
      });
      expect(result.auto_actions).toHaveLength(2);
      expect(result.auto_actions[0]).toEqual({
        type: "add_tag",
        tag_name: "qualificado",
      });
      expect(result.auto_actions[1]).toEqual({
        type: "send_media",
        slug: "catalogo-pdf",
      });
    });

    it("limita a 10 acoes por etapa", () => {
      const many = Array.from({ length: 15 }, (_, i) => ({
        type: "add_tag" as const,
        tag_name: `tag-${i}`,
      }));
      const result = normalizeStageActionConfig({ auto_actions: many });
      expect(result.auto_actions).toHaveLength(10);
    });
  });

  describe("sanitizeStageAutoAction", () => {
    it("aceita add_tag com tag_name valido", () => {
      const result = sanitizeStageAutoAction({
        type: "add_tag",
        tag_name: "  Qualificado  ",
      });
      expect(result).toEqual({ type: "add_tag", tag_name: "Qualificado" });
    });

    it("rejeita add_tag sem tag_name", () => {
      expect(sanitizeStageAutoAction({ type: "add_tag" })).toBeNull();
      expect(sanitizeStageAutoAction({ type: "add_tag", tag_name: "" })).toBeNull();
      expect(sanitizeStageAutoAction({ type: "add_tag", tag_name: "   " })).toBeNull();
    });

    it("preserva caption opcional em send_media", () => {
      expect(
        sanitizeStageAutoAction({
          type: "send_media",
          slug: "catalogo",
          caption: "Aqui esta!",
        }),
      ).toEqual({ type: "send_media", slug: "catalogo", caption: "Aqui esta!" });
    });

    it("descarta caption vazia em send_media", () => {
      expect(
        sanitizeStageAutoAction({
          type: "send_media",
          slug: "catalogo",
          caption: "   ",
        }),
      ).toEqual({ type: "send_media", slug: "catalogo" });
    });

    it("aceita trigger_notification com custom map sanitizado", () => {
      const result = sanitizeStageAutoAction({
        type: "trigger_notification",
        template_name: "Lead Novo",
        custom: { produto: "Plano Gold", precos: "  " }, // precos vazio
      });
      expect(result).toEqual({
        type: "trigger_notification",
        template_name: "Lead Novo",
        custom: { produto: "Plano Gold" },
      });
    });

    it("aceita stop_agent sem reason", () => {
      expect(sanitizeStageAutoAction({ type: "stop_agent" })).toEqual({
        type: "stop_agent",
      });
    });

    it("rejeita tipo desconhecido", () => {
      expect(sanitizeStageAutoAction({ type: "blow_up_database" })).toBeNull();
    });

    it("rejeita input nao-objeto", () => {
      expect(sanitizeStageAutoAction(null)).toBeNull();
      expect(sanitizeStageAutoAction("string")).toBeNull();
      expect(sanitizeStageAutoAction([1, 2])).toBeNull();
    });

    it("cobre todos os tipos de STAGE_AUTO_ACTION_TYPES", () => {
      // garantia que adicionar novo tipo aciona quebra no test
      expect(STAGE_AUTO_ACTION_TYPES.length).toBe(7);
    });
  });

  // ==========================================================================
  // PR2 (mai/2026) — trigger on_enter vs on_tool_success
  // ==========================================================================
  describe("trigger fields", () => {
    it("retrocompat: acao sem trigger fica como on_enter (sem fields explicitos)", () => {
      const result = sanitizeStageAutoAction({
        type: "add_tag",
        tag_name: "qualificado",
      });
      expect(result).toEqual({ type: "add_tag", tag_name: "qualificado" });
      // Confirma que NAO incluiu trigger/on_tool_success_of
      expect(result).not.toHaveProperty("trigger");
      expect(result).not.toHaveProperty("on_tool_success_of");
    });

    it("preserva trigger='on_tool_success' com handler valido", () => {
      const result = sanitizeStageAutoAction({
        type: "add_tag",
        tag_name: "agendou",
        trigger: "on_tool_success",
        on_tool_success_of: "create_appointment",
      });
      expect(result).toEqual({
        type: "add_tag",
        tag_name: "agendou",
        trigger: "on_tool_success",
        on_tool_success_of: "create_appointment",
      });
    });

    it("DROPA a acao quando trigger=on_tool_success sem on_tool_success_of", () => {
      const result = sanitizeStageAutoAction({
        type: "trigger_notification",
        template_name: "Lead novo",
        trigger: "on_tool_success",
      });
      expect(result).toBeNull();
    });

    it("DROPA a acao quando trigger=on_tool_success com handler invalido", () => {
      const result = sanitizeStageAutoAction({
        type: "add_tag",
        tag_name: "tag",
        trigger: "on_tool_success",
        on_tool_success_of: "blow_up_database",
      });
      expect(result).toBeNull();
    });

    it("DROPA a acao quando trigger e string desconhecida", () => {
      const result = sanitizeStageAutoAction({
        type: "add_tag",
        tag_name: "tag",
        trigger: "on_purple_moon",
      });
      expect(result).toBeNull();
    });

    it("aceita trigger='on_enter' explicito (no-op vs default)", () => {
      const result = sanitizeStageAutoAction({
        type: "add_tag",
        tag_name: "tag",
        trigger: "on_enter",
      });
      // on_enter explicito nao polui o shape — fica equivalente ao default.
      expect(result).toEqual({ type: "add_tag", tag_name: "tag" });
    });

    it("normalizeStageActionConfig dropa acoes com trigger invalido + mantem outras", () => {
      const result = normalizeStageActionConfig({
        auto_actions: [
          { type: "add_tag", tag_name: "ok" }, // valida
          {
            type: "add_tag",
            tag_name: "tag",
            trigger: "on_tool_success", // sem on_tool_success_of → dropa
          },
          {
            type: "trigger_notification",
            template_name: "Reuniao",
            trigger: "on_tool_success",
            on_tool_success_of: "create_appointment",
          }, // valida
        ],
      });
      expect(result.auto_actions).toHaveLength(2);
      expect(result.auto_actions[0]).toEqual({ type: "add_tag", tag_name: "ok" });
      expect(result.auto_actions[1]).toMatchObject({
        type: "trigger_notification",
        template_name: "Reuniao",
        trigger: "on_tool_success",
        on_tool_success_of: "create_appointment",
      });
    });
  });

  describe("actions_executed idempotency", () => {
    it("normalizeActionsExecuted dedup + ignora invalidos", () => {
      expect(
        normalizeActionsExecuted(["stage-1", "stage-2", "stage-1", null, ""]),
      ).toEqual(["stage-1", "stage-2"]);
    });

    it("hasActionsBeenExecuted detecta corretamente", () => {
      expect(hasActionsBeenExecuted(["stage-1"], "stage-1")).toBe(true);
      expect(hasActionsBeenExecuted(["stage-1"], "stage-2")).toBe(false);
    });

    it("markActionsExecuted e idempotente", () => {
      const after = markActionsExecuted(["stage-1"], "stage-2");
      expect(after).toEqual(["stage-1", "stage-2"]);
      const sameAgain = markActionsExecuted(after, "stage-1");
      expect(sameAgain).toEqual(["stage-1", "stage-2"]); // dedup
    });
  });
});
