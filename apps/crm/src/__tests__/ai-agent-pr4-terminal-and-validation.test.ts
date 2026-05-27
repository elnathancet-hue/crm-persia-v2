// PR-4 Auditoria (mai/2026) — testes dos fixes da rodada 1, 3, 7, 9.
//
// Foco:
//   - shouldResetCurrentNodeId: action/condition → reset; ai_agent → preserva.
//   - validateFlowConfig: crm_event_to_ai agora e severity='error' (era warning).
//
// Pure-function tests (sem mocks de DB/OpenAI) — testam a logica isolada
// que foi extraida do executor.ts pra `@persia/shared/ai-agent` em PR-4.

import { describe, expect, it } from "vitest";
import type {
  FlowAIAgentNode,
  FlowActionNode,
  FlowConditionNode,
  FlowConfig,
  FlowEntryNode,
} from "@persia/shared/ai-agent";
import {
  shouldResetCurrentNodeId,
  validateFlowConfig,
} from "@persia/shared/ai-agent";

function makeFlow(overrides: Partial<FlowConfig> = {}): FlowConfig {
  return {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    enabled_tools: [],
    ...overrides,
  };
}

function entryNode(id: string, trigger: FlowEntryNode["data"]["trigger"] = "conversation_started"): FlowEntryNode {
  return {
    id,
    type: "entry",
    position: { x: 0, y: 0 },
    data: { label: "Início", trigger },
  };
}

function aiNode(id: string): FlowAIAgentNode {
  return {
    id,
    type: "ai_agent",
    position: { x: 0, y: 0 },
    data: { label: "IA", system_prompt: "", instructions: [] },
  };
}

function actionNode(id: string): FlowActionNode {
  return {
    id,
    type: "action",
    position: { x: 0, y: 0 },
    data: { label: "Tag", action_type: "add_tag", config: { tag_name: "x" } },
  };
}

function conditionNode(id: string): FlowConditionNode {
  return {
    id,
    type: "condition",
    position: { x: 0, y: 0 },
    data: { label: "Cond", condition_type: "has_tag", config: { tag_name: "x" } },
  };
}

describe("PR-4: shouldResetCurrentNodeId (rodada 1 #1 + rodada 9 #4)", () => {
  it("retorna false quando ending_node_id e null (flow nao iniciou)", () => {
    const flow = makeFlow({ nodes: [entryNode("entry-1")] });
    expect(shouldResetCurrentNodeId(flow, null)).toBe(false);
  });

  it("retorna false quando termina em ai_agent (preserva continuidade conversacional)", () => {
    const flow = makeFlow({ nodes: [entryNode("entry-1"), aiNode("ai-1")] });
    expect(shouldResetCurrentNodeId(flow, "ai-1")).toBe(false);
  });

  it("retorna false quando termina em entry (degenerate, mas valido)", () => {
    const flow = makeFlow({ nodes: [entryNode("entry-1")] });
    expect(shouldResetCurrentNodeId(flow, "entry-1")).toBe(false);
  });

  it("retorna true quando termina em action (evita reexecutar add_tag/send_whatsapp/etc.)", () => {
    const flow = makeFlow({
      nodes: [entryNode("entry-1"), actionNode("act-1")],
    });
    expect(shouldResetCurrentNodeId(flow, "act-1")).toBe(true);
  });

  it("retorna true quando termina em condition (evita reavaliar ramificacao)", () => {
    const flow = makeFlow({
      nodes: [entryNode("entry-1"), conditionNode("cond-1")],
    });
    expect(shouldResetCurrentNodeId(flow, "cond-1")).toBe(true);
  });

  it("retorna true quando node nao existe mais (foi removido entre runs)", () => {
    const flow = makeFlow({ nodes: [entryNode("entry-1")] });
    expect(shouldResetCurrentNodeId(flow, "node-deletado")).toBe(true);
  });
});

describe("PR-4: validateFlowConfig CRM event → AI vira error (rodada 3 #5)", () => {
  it("crm_event_to_ai e severity='error' quando entry e pipeline_stage_entered + alvo e ai_agent", () => {
    const flow = makeFlow({
      nodes: [
        entryNode("entry-1", "pipeline_stage_entered"),
        aiNode("ai-1"),
      ],
      edges: [
        { id: "e1", source: "entry-1", target: "ai-1", sourceHandle: "default" },
      ],
    });
    const issues = validateFlowConfig(flow);
    const crmEventIssue = issues.find((i) => i.code === "crm_event_to_ai");
    expect(crmEventIssue).toBeDefined();
    expect(crmEventIssue?.severity).toBe("error");
    expect(crmEventIssue?.node_id).toBe("ai-1");
  });

  it("crm_event_to_ai dispara tambem com segment_entered", () => {
    const flow = makeFlow({
      nodes: [
        entryNode("entry-1", "segment_entered"),
        aiNode("ai-1"),
      ],
      edges: [
        { id: "e1", source: "entry-1", target: "ai-1", sourceHandle: "default" },
      ],
    });
    const issues = validateFlowConfig(flow);
    const crmEventIssue = issues.find((i) => i.code === "crm_event_to_ai");
    expect(crmEventIssue).toBeDefined();
    expect(crmEventIssue?.severity).toBe("error");
  });

  it("NAO dispara quando entry e conversation_started (lead trouxe inbound text)", () => {
    const flow = makeFlow({
      nodes: [
        entryNode("entry-1", "conversation_started"),
        aiNode("ai-1"),
      ],
      edges: [
        { id: "e1", source: "entry-1", target: "ai-1", sourceHandle: "default" },
      ],
    });
    const issues = validateFlowConfig(flow);
    expect(issues.find((i) => i.code === "crm_event_to_ai")).toBeUndefined();
  });

  it("NAO dispara quando entry CRM aponta pra action node (caminho correto)", () => {
    const flow = makeFlow({
      nodes: [
        entryNode("entry-1", "pipeline_stage_entered"),
        actionNode("act-1"),
      ],
      edges: [
        { id: "e1", source: "entry-1", target: "act-1", sourceHandle: "default" },
      ],
    });
    const issues = validateFlowConfig(flow);
    expect(issues.find((i) => i.code === "crm_event_to_ai")).toBeUndefined();
  });
});
