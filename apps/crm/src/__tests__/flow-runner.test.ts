// Tests do flow-runner (PR-FLOW-PIVOT PR 2, mai/2026).
//
// Foco:
//   - Entry node segue edge `default` pro próximo node
//   - Action node executa handler nativo e segue edge `default`
//   - Flow termina quando não há próximo node
//   - Guardrail: max iterations
//   - Guardrail: flow sem entry node
//   - Guardrail: node não encontrado
//   - Condition node retorna fatal_error (V1 não implementa)
//
// AI Agent node NÃO é testado aqui (precisa de OpenAI mock pesado) —
// fica pra integration test posterior. Núcleo do dispatcher é coberto
// indiretamente nos handlers nativos (ai-agent-*.test.ts).

import { describe, expect, it, vi } from "vitest";
import type { FlowConfig } from "@persia/shared/ai-agent";

// server-only é importado transitivamente por alguns handlers nativos
// (pause-agent, notifications). Stub global pra rodar em ambiente Node
// puro — testamos só o runner, não os handlers (cobertos em outros tests).
vi.mock("server-only", () => ({}));

import { runFlow } from "@/lib/ai-agent/flow/runner";
import { createTesterProvider } from "@/lib/ai-agent/flow/tester-provider";
import type {
  FlowRunContext,
  FlowRunResult,
} from "@/lib/ai-agent/flow/types";
import type { LoadedFlow } from "@/lib/ai-agent/flow/loader";

function makeFlow(overrides: Partial<FlowConfig> = {}): FlowConfig {
  return {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    enabled_tools: [],
    ...overrides,
  };
}

function makeLoadedFlow(config: FlowConfig): LoadedFlow {
  return {
    id: "flow-1",
    agent_config_id: "config-1",
    organization_id: "org-1",
    version: 1,
    config,
  };
}

function makeCtx(flow: LoadedFlow): FlowRunContext {
  return {
    flow,
    agentConfigId: "config-1",
    organizationId: "org-1",
    crmConversationId: "conv-1",
    agentConversationId: "agent-conv-1",
    leadId: "lead-1",
    inboundMessage: {
      text: "oi",
      received_at: new Date().toISOString(),
    },
    provider: createTesterProvider(),
    dryRun: true,
    flowConfig: flow.config,
  };
}

// DB stub mínimo — runFlow só usa db pra carregar tools/config quando há
// AI node. Pra cenários sem AI node, o stub nunca é tocado.
const dbStub = {
  from: () => ({
    select: () => ({
      eq: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  }),
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("flow-runner", () => {
  it("retorna fatal_error quando flow não tem entry node", async () => {
    const flow = makeLoadedFlow(makeFlow());
    const ctx = makeCtx(flow);
    const result = await runFlow(dbStub, ctx, null);
    expect(result.fatal_error).toBe("flow_sem_entry_node");
    expect(result.ending_node_id).toBeNull();
  });

  it("entry node segue edge default e termina sem próximo", async () => {
    const flow = makeLoadedFlow(
      makeFlow({
        nodes: [
          {
            id: "entry-1",
            type: "entry",
            position: { x: 0, y: 0 },
            data: { label: "Início", trigger: "conversation_started" },
          },
          {
            id: "action-1",
            type: "action",
            position: { x: 200, y: 0 },
            data: {
              label: "Adicionar tag teste",
              action_type: "add_tag",
              config: { tag_name: "lead-novo" },
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry-1",
            target: "action-1",
            sourceHandle: "default",
          },
        ],
      }),
    );
    const ctx = makeCtx(flow);
    const result = await runFlow(dbStub, ctx, null);

    // Em dry_run o handler add_tag não toca DB, mas o runner segue normal.
    // ending_node_id deve ser action-1 (sem edges saindo dele).
    expect(result.ending_node_id).toBe("action-1");
    expect(result.fatal_error).toBeUndefined();
    expect(result.hit_max_iterations).toBe(false);
  });

  it("para com fatal_error quando edge aponta pra node inexistente", async () => {
    // Edge `entry-1 → fantasma` (target não existe). Em produção isso é
    // descartado pelo normalizeFlowConfig (loader), mas testamos defesa
    // direta: se a config vier corrompida (bypass), runner não loopa.
    const flow = makeLoadedFlow(
      makeFlow({
        nodes: [
          {
            id: "entry-1",
            type: "entry",
            position: { x: 0, y: 0 },
            data: { label: "Início", trigger: "conversation_started" },
          },
        ],
        edges: [
          {
            id: "e-broken",
            source: "entry-1",
            target: "fantasma",
            sourceHandle: "default",
          },
        ],
      }),
    );
    const ctx = makeCtx(flow);
    const result = await runFlow(dbStub, ctx, null);
    expect(result.fatal_error).toBe("node_not_found:fantasma");
  });

  it("condition node sem lead_id segue caminho 'no'", async () => {
    // PR 5 (mai/2026): condition agora é avaliado. Sem leadId no contexto
    // (ex: testes iniciais sem lead vinculado), evaluateCondition retorna
    // false → segue edge "no".
    const flow = makeLoadedFlow(
      makeFlow({
        nodes: [
          {
            id: "entry-1",
            type: "entry",
            position: { x: 0, y: 0 },
            data: { label: "Início", trigger: "conversation_started" },
          },
          {
            id: "cond-1",
            type: "condition",
            position: { x: 200, y: 0 },
            data: {
              label: "Tem tag X",
              condition_type: "has_tag",
              config: { tag_name: "qualificado" },
            },
          },
          {
            id: "yes-target",
            type: "action",
            position: { x: 400, y: -80 },
            data: { label: "Caminho sim", action_type: "stop_agent", config: {} },
          },
          {
            id: "no-target",
            type: "action",
            position: { x: 400, y: 80 },
            data: { label: "Caminho não", action_type: "stop_agent", config: {} },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry-1",
            target: "cond-1",
            sourceHandle: "default",
          },
          {
            id: "e-yes",
            source: "cond-1",
            target: "yes-target",
            sourceHandle: "yes",
          },
          {
            id: "e-no",
            source: "cond-1",
            target: "no-target",
            sourceHandle: "no",
          },
        ],
      }),
    );
    // makeCtx default tem leadId="lead-1" — vamos sobrescrever pra null
    // pra forçar o caminho "no" defensivo (sem hit DB).
    const ctx = makeCtx(flow);
    ctx.leadId = null;
    const result = await runFlow(dbStub, ctx, null);
    expect(result.fatal_error).toBeUndefined();
    expect(result.ending_node_id).toBe("no-target");
  });

  it("respeita maxIterations e seta hit_max_iterations", async () => {
    // Flow cíclico: action-1 → action-1 (edge auto-referencial, normalizado
    // permite mas é loop infinito).
    const flow = makeLoadedFlow(
      makeFlow({
        nodes: [
          {
            id: "entry-1",
            type: "entry",
            position: { x: 0, y: 0 },
            data: { label: "Início", trigger: "conversation_started" },
          },
          {
            id: "action-1",
            type: "action",
            position: { x: 200, y: 0 },
            data: {
              label: "Loop",
              action_type: "stop_agent",
              config: {},
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry-1",
            target: "action-1",
            sourceHandle: "default",
          },
          {
            id: "e-loop",
            source: "action-1",
            target: "action-1",
            sourceHandle: "default",
          },
        ],
      }),
    );
    const ctx = makeCtx(flow);
    const result: FlowRunResult = await runFlow(dbStub, ctx, null, {
      maxIterations: 5,
    });
    expect(result.hit_max_iterations).toBe(true);
  });

  it("captura eventos node_entered/exited via provider", async () => {
    const flow = makeLoadedFlow(
      makeFlow({
        nodes: [
          {
            id: "entry-1",
            type: "entry",
            position: { x: 0, y: 0 },
            data: { label: "Início", trigger: "conversation_started" },
          },
          {
            id: "action-1",
            type: "action",
            position: { x: 200, y: 0 },
            data: {
              label: "Stop",
              action_type: "stop_agent",
              config: {},
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry-1",
            target: "action-1",
            sourceHandle: "default",
          },
        ],
      }),
    );
    const ctx = makeCtx(flow);
    await runFlow(dbStub, ctx, null);
    const events = ctx.provider.getEvents();
    const entered = events.filter((e) => e.kind === "node_entered");
    expect(entered.map((e) => (e.payload as { node_id: string }).node_id)).toEqual([
      "entry-1",
      "action-1",
    ]);
  });
});
