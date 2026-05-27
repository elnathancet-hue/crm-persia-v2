// PR-6 Auditoria (mai/2026) — testes dos fixes da rodada 1 #3, 3 #1/#2/#3.
//
// Foco:
//   - validateFlowConfig: create_appointment exige start_at.
//   - flowActionTypeToNativeHandler: remove_tag agora mapeia.
//   - removeTagHandler: comportamento completo + dry_run.

import { describe, expect, it, vi } from "vitest";
import {
  flowActionTypeToNativeHandler,
  validateFlowConfig,
  type FlowConfig,
} from "@persia/shared/ai-agent";
import { removeTagHandler } from "@/lib/ai-agent/tools/remove-tag";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

function actionFlow(actionType: string, config: Record<string, unknown>): FlowConfig {
  return {
    nodes: [
      {
        id: "entry-1",
        type: "entry",
        position: { x: 0, y: 0 },
        data: { label: "Início", trigger: "conversation_started" },
      },
      {
        id: "act-1",
        type: "action",
        position: { x: 200, y: 0 },
        data: {
          label: "Ação",
          action_type: actionType,
          config,
        },
      } as never,
    ],
    edges: [
      { id: "e1", source: "entry-1", target: "act-1", sourceHandle: "default" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    enabled_tools: [],
  };
}

describe("PR-6: validateFlowConfig create_appointment exige start_at", () => {
  it("vira error quando start_at esta vazio", () => {
    const flow = actionFlow("create_appointment", {});
    const issues = validateFlowConfig(flow);
    const issue = issues.find((i) => i.code === "action_incomplete");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toContain("data e hora");
  });

  it("passa quando start_at e ISO valido", () => {
    const flow = actionFlow("create_appointment", {
      start_at: "2026-06-01T14:00:00.000Z",
    });
    const issues = validateFlowConfig(flow);
    expect(issues.find((i) => i.code === "action_incomplete")).toBeUndefined();
  });

  it("type_slug e duration sao opcionais", () => {
    const flow = actionFlow("create_appointment", {
      start_at: "2026-06-01T14:00:00.000Z",
      type_slug: "consulta-30min",
      duration_minutes: 45,
    });
    const issues = validateFlowConfig(flow);
    expect(issues.find((i) => i.code === "action_incomplete")).toBeUndefined();
  });
});

describe("PR-6: flowActionTypeToNativeHandler mapeia remove_tag", () => {
  it("remove_tag mapeia pro handler nativo (rodada 1 #3)", () => {
    expect(flowActionTypeToNativeHandler("remove_tag")).toBe("remove_tag");
  });

  it("add_tag continua mapeando (regressao)", () => {
    expect(flowActionTypeToNativeHandler("add_tag")).toBe("add_tag");
  });
});

describe("PR-6: removeTagHandler", () => {
  function ctxBase(overrides: Record<string, unknown> = {}) {
    return {
      organization_id: "org-1",
      lead_id: "lead-1",
      crm_conversation_id: "crm-1",
      agent_conversation_id: "ac-1",
      run_id: "",
      dry_run: false,
      ...overrides,
    };
  }

  it("invalid input retorna failure", async () => {
    const supabase = createSupabaseMock();
    const result = await removeTagHandler(
      { ...ctxBase(), db: supabase as never } as never,
      { tag_name: "" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("invalid");
  });

  it("tag nao existe no catalogo retorna success com reason=tag_not_in_catalog", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: null, error: null });
    const result = await removeTagHandler(
      { ...ctxBase(), db: supabase as never } as never,
      { tag_name: "Tag Fantasma" },
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      removed: false,
      reason: "tag_not_in_catalog",
    });
  });

  it("lead nao tem a tag retorna success com reason=lead_does_not_have_tag", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: { id: "tag-1", name: "vip" }, error: null });
    // lead_tags lookup → null
    supabase.queue("lead_tags", { data: null, error: null });
    const result = await removeTagHandler(
      { ...ctxBase(), db: supabase as never } as never,
      { tag_name: "vip" },
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      removed: false,
      reason: "lead_does_not_have_tag",
    });
    // NAO deve ter DELETE em lead_tags
    expect(supabase.deletes.lead_tags).toBeUndefined();
  });

  it("dry_run nao deleta (paridade producao)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: { id: "tag-1", name: "vip" }, error: null });
    supabase.queue("lead_tags", { data: { lead_id: "lead-1", tag_id: "tag-1" }, error: null });

    const result = await removeTagHandler(
      { ...ctxBase({ dry_run: true }), db: supabase as never } as never,
      { tag_name: "vip" },
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ removed: true, tag_name: "vip" });
    expect(supabase.deletes.lead_tags).toBeUndefined();
  });

  it("happy path: lead com tag remove + audit em lead_activities", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: { id: "tag-1", name: "vip" }, error: null });
    supabase.queue("lead_tags", { data: { lead_id: "lead-1", tag_id: "tag-1" }, error: null });

    const result = await removeTagHandler(
      { ...ctxBase(), db: supabase as never } as never,
      { tag_name: "vip" },
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      removed: true,
      tag_id: "tag-1",
      tag_name: "vip",
    });
    // Audit log inserido
    const activityInserts = supabase.inserts.lead_activities as Array<Record<string, unknown>>;
    expect(activityInserts).toHaveLength(1);
    expect(activityInserts[0]).toMatchObject({
      type: "tag_removed",
      description: expect.stringContaining("vip"),
    });
  });
});
