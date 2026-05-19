import { describe, expect, it } from "vitest";
import {
  getStageActionState,
  hasActionsBeenExecuted,
  isStageFullyCompleted,
  makeOnEnterKey,
  makeOnToolSuccessKey,
  markActionsExecuted,
  MAX_AUTO_ACTION_RETRIES,
  normalizeActionsExecuted,
  normalizeActionsExecutedDetail,
  normalizeStageActionConfig,
  recordActionFailure,
  recordActionSuccess,
  sanitizeStageAutoAction,
  shouldSkipActionIndex,
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

  // ==========================================================================
  // PR3 (mai/2026) — per-action retry tracking helpers
  // ==========================================================================
  describe("per-action retry tracking", () => {
    describe("trigger keys", () => {
      it("makeOnEnterKey usa formato 'on_enter:<stage_id>'", () => {
        expect(makeOnEnterKey("stage-123")).toBe("on_enter:stage-123");
      });

      it("makeOnToolSuccessKey usa formato 'on_tool_success:<stage>:<tool>'", () => {
        expect(makeOnToolSuccessKey("stage-1", "create_appointment")).toBe(
          "on_tool_success:stage-1:create_appointment",
        );
      });
    });

    describe("normalizeActionsExecutedDetail", () => {
      it("retorna vazio quando raw e null/invalido/array", () => {
        expect(normalizeActionsExecutedDetail(null)).toEqual({});
        expect(normalizeActionsExecutedDetail(undefined)).toEqual({});
        expect(normalizeActionsExecutedDetail([])).toEqual({});
        expect(normalizeActionsExecutedDetail("string")).toEqual({});
      });

      it("preserva shape valido + descarta indices nao-numericos em failed", () => {
        const result = normalizeActionsExecutedDetail({
          "on_enter:s1": {
            succeeded: [0, 2],
            failed: {
              "1": { attempts: 2, last_error: "timeout" },
              "abc": { attempts: 1, last_error: "x" }, // descartado
              "-1": { attempts: 1, last_error: "x" }, // descartado
            },
          },
        });
        expect(result["on_enter:s1"]?.succeeded).toEqual([0, 2]);
        expect(result["on_enter:s1"]?.failed).toEqual({
          "1": { attempts: 2, last_error: "timeout" },
        });
      });

      it("descarta valores nao-numericos em succeeded + dedup", () => {
        const result = normalizeActionsExecutedDetail({
          "on_enter:s1": {
            succeeded: [0, "bad", 0, NaN, 2],
            failed: {},
          },
        });
        expect(result["on_enter:s1"]?.succeeded).toEqual([0, 2]);
      });

      it("trunca last_error em 500 chars (defensive)", () => {
        const longError = "x".repeat(1000);
        const result = normalizeActionsExecutedDetail({
          "on_enter:s1": {
            succeeded: [],
            failed: { "0": { attempts: 1, last_error: longError } },
          },
        });
        expect(result["on_enter:s1"]?.failed["0"]?.last_error.length).toBe(500);
      });
    });

    describe("recordActionSuccess", () => {
      it("adiciona indice em succeeded + limpa de failed se existir", () => {
        const initial = {
          "on_enter:s1": {
            succeeded: [0],
            failed: { "1": { attempts: 2, last_error: "x" } },
          },
        };
        const result = recordActionSuccess(initial, "on_enter:s1", 1);
        expect(result["on_enter:s1"]?.succeeded).toEqual([0, 1]);
        expect(result["on_enter:s1"]?.failed).toEqual({}); // limpou
      });

      it("idempotente: gravar success 2x nao duplica", () => {
        const first = recordActionSuccess({}, "on_enter:s1", 0);
        const second = recordActionSuccess(first, "on_enter:s1", 0);
        expect(second["on_enter:s1"]?.succeeded).toEqual([0]);
      });
    });

    describe("recordActionFailure", () => {
      it("incrementa attempts a cada chamada", () => {
        const a = recordActionFailure({}, "on_enter:s1", 0, "err1");
        const b = recordActionFailure(a, "on_enter:s1", 0, "err2");
        const c = recordActionFailure(b, "on_enter:s1", 0, "err3");
        expect(c["on_enter:s1"]?.failed["0"]?.attempts).toBe(3);
        expect(c["on_enter:s1"]?.failed["0"]?.last_error).toBe("err3");
      });

      it("nao afeta succeeded de outros indices", () => {
        const initial = {
          "on_enter:s1": { succeeded: [0], failed: {} },
        };
        const result = recordActionFailure(initial, "on_enter:s1", 1, "err");
        expect(result["on_enter:s1"]?.succeeded).toEqual([0]);
        expect(result["on_enter:s1"]?.failed["1"]?.attempts).toBe(1);
      });
    });

    describe("shouldSkipActionIndex", () => {
      it("skipa quando ja succeeded", () => {
        const state = getStageActionState(
          { "on_enter:s1": { succeeded: [0, 2], failed: {} } },
          "on_enter:s1",
        );
        expect(shouldSkipActionIndex(state, 0)).toBe(true);
        expect(shouldSkipActionIndex(state, 2)).toBe(true);
        expect(shouldSkipActionIndex(state, 1)).toBe(false);
      });

      it("skipa quando attempts >= MAX_RETRIES", () => {
        const state = getStageActionState(
          {
            "on_enter:s1": {
              succeeded: [],
              failed: { "0": { attempts: MAX_AUTO_ACTION_RETRIES, last_error: "x" } },
            },
          },
          "on_enter:s1",
        );
        expect(shouldSkipActionIndex(state, 0)).toBe(true);
      });

      it("NAO skipa quando attempts < MAX_RETRIES", () => {
        const state = getStageActionState(
          {
            "on_enter:s1": {
              succeeded: [],
              failed: { "0": { attempts: 1, last_error: "x" } },
            },
          },
          "on_enter:s1",
        );
        expect(shouldSkipActionIndex(state, 0)).toBe(false);
      });
    });

    describe("isStageFullyCompleted", () => {
      it("true quando todos os indices estao em succeeded", () => {
        const state = getStageActionState(
          { "on_enter:s1": { succeeded: [0, 1, 2], failed: {} } },
          "on_enter:s1",
        );
        expect(isStageFullyCompleted(state, 3)).toBe(true);
      });

      it("true quando mistura: alguns succeeded + outros exceeded retries", () => {
        const state = getStageActionState(
          {
            "on_enter:s1": {
              succeeded: [0],
              failed: { "1": { attempts: MAX_AUTO_ACTION_RETRIES, last_error: "x" } },
            },
          },
          "on_enter:s1",
        );
        expect(isStageFullyCompleted(state, 2)).toBe(true);
      });

      it("false quando algum indice tem attempts < MAX_RETRIES", () => {
        const state = getStageActionState(
          {
            "on_enter:s1": {
              succeeded: [0],
              failed: { "1": { attempts: 1, last_error: "x" } },
            },
          },
          "on_enter:s1",
        );
        expect(isStageFullyCompleted(state, 2)).toBe(false);
      });

      it("false quando algum indice nao apareceu nem em succeeded nem em failed", () => {
        const state = getStageActionState(
          { "on_enter:s1": { succeeded: [0], failed: {} } },
          "on_enter:s1",
        );
        // index 1 nao foi tocado — proxima entrada deve rodar
        expect(isStageFullyCompleted(state, 2)).toBe(false);
      });

      it("true pra stage com zero acoes (caso degenerado)", () => {
        const state = getStageActionState({}, "on_enter:s1");
        expect(isStageFullyCompleted(state, 0)).toBe(true);
      });
    });
  });
});
