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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowConfig, FlowEntryNode } from "@persia/shared/ai-agent";
import { shouldTriggerFlowFromInbound } from "@persia/shared/ai-agent";

// server-only é importado transitivamente por alguns handlers nativos
// (pause-agent, notifications). Stub global pra rodar em ambiente Node
// puro — testamos só o runner, não os handlers (cobertos em outros tests).
vi.mock("server-only", () => ({}));

const openAiCreateMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: openAiCreateMock,
      },
    },
  })),
}));

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
} as any;

describe("flow-runner", () => {
  beforeEach(() => {
    openAiCreateMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

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

  it("send_whatsapp_message action emite send_text com placeholders resolvidos", async () => {
    // PR 9 (mai/2026): action node standalone — texto literal com
    // {{lead.X}}. Validamos: (a) evento send_text emitido, (b) placeholder
    // interpolado contra lead carregado do DB, (c) flow segue edge default.
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
            id: "msg-1",
            type: "action",
            position: { x: 200, y: 0 },
            data: {
              label: "Boas-vindas",
              action_type: "send_whatsapp_message",
              config: { message: "Oi {{lead.name}}, tudo bem?" },
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry-1",
            target: "msg-1",
            sourceHandle: "default",
          },
        ],
      }),
    );
    const ctx = makeCtx(flow);
    // DB stub específico desse teste — retorna name="Ana" pra `leads`.
    const dbWithLead = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { name: "Ana", phone: "+5511999", email: null },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    } as any;
    const result = await runFlow(dbWithLead, ctx, null);

    expect(result.fatal_error).toBeUndefined();
    expect(result.ending_node_id).toBe("msg-1");
    expect(result.tool_calls_succeeded).toBe(1);
    expect(result.assistant_reply).toBe("Oi Ana, tudo bem?");

    const events = ctx.provider.getEvents();
    const sendText = events.find((e) => e.kind === "send_text");
    expect(sendText).toBeDefined();
    expect((sendText?.payload as { message: string }).message).toBe(
      "Oi Ana, tudo bem?",
    );
    expect((sendText?.payload as { via?: string }).via).toBe("action_node");
  });

  it("send_whatsapp_message com message vazio falha gracefully e segue default", async () => {
    // Config corrompida (message vazio) não deve crashar — só emite
    // tool_result com error e segue edge.
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
            id: "msg-empty",
            type: "action",
            position: { x: 200, y: 0 },
            data: {
              label: "Vazio",
              action_type: "send_whatsapp_message",
              config: { message: "   " },
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry-1",
            target: "msg-empty",
            sourceHandle: "default",
          },
        ],
      }),
    );
    const ctx = makeCtx(flow);
    const result = await runFlow(dbStub, ctx, null);

    expect(result.fatal_error).toBeUndefined();
    expect(result.tool_calls_failed).toBe(1);
    const events = ctx.provider.getEvents();
    const toolResult = events.find(
      (e) =>
        e.kind === "tool_result" &&
        (e.payload as { tool_name?: string }).tool_name ===
          "send_whatsapp_message",
    );
    expect(toolResult).toBeDefined();
    expect((toolResult?.payload as { success: boolean }).success).toBe(false);
    expect((toolResult?.payload as { error: string }).error).toBe(
      "empty_message",
    );
  });

  it("AI node com inbound vazio skipa LLM e segue default (PR 11, mai/2026)", async () => {
    // Quando flow é disparado por evento CRM (ex: stage_entered), não
    // há msg do lead. AI node deve pular LLM call gracefully em vez de
    // mandar pro OpenAI com user content="".
    const flow = makeLoadedFlow(
      makeFlow({
        nodes: [
          {
            id: "entry-1",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              label: "Início",
              trigger: "pipeline_stage_entered",
              config: { stage_id: "stage-x" },
            },
          },
          {
            id: "ai-1",
            type: "ai_agent",
            position: { x: 200, y: 0 },
            data: {
              label: "IA",
              system_prompt: "Cumprimente o lead",
              instructions: [],
            },
          },
          {
            id: "next-action",
            type: "action",
            position: { x: 400, y: 0 },
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
            target: "ai-1",
            sourceHandle: "default",
          },
          {
            id: "e2",
            source: "ai-1",
            target: "next-action",
            sourceHandle: "default",
          },
        ],
      }),
    );
    const ctx = makeCtx(flow);
    // Synthetic event-driven: inbound vazio (não tem msg do lead).
    ctx.inboundMessage = { text: "", received_at: new Date().toISOString() };
    const result = await runFlow(dbStub, ctx, null);

    expect(result.fatal_error).toBeUndefined();
    // Esperado: entry -> ai (skipped) -> next-action (stop_agent)
    expect(result.ending_node_id).toBe("next-action");

    const events = ctx.provider.getEvents();
    const guardrail = events.find(
      (e) =>
        e.kind === "guardrail" &&
        (e.payload as { reason?: string }).reason === "ai_node_skipped_no_inbound",
    );
    expect(guardrail).toBeDefined();
    // LLM call não foi emitido (não bateu na OpenAI).
    expect(events.some((e) => e.kind === "llm_call")).toBe(false);
  });

  it("AI node concatena prompt local do fluxo antes do prompt geral do agente", async () => {
    openAiCreateMock.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "Resposta final." },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    });

    const dbWithAgentPrompt = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    table === "agent_configs"
                      ? {
                          model: "gpt-5-mini",
                          system_prompt: "PROMPT GERAL CONFIGURADO",
                        }
                      : null,
                  error: null,
                }),
            }),
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    } as any;

    const flow = makeLoadedFlow(
      makeFlow({
        nodes: [
          {
            id: "entry-1",
            type: "entry",
            position: { x: 0, y: 0 },
            data: { label: "Inicio", trigger: "conversation_started" },
          },
          {
            id: "ai-1",
            type: "ai_agent",
            position: { x: 200, y: 0 },
            data: {
              label: "IA",
              system_prompt: "PROMPT LOCAL DO FLUXO",
              instructions: [],
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry-1",
            target: "ai-1",
            sourceHandle: "default",
          },
        ],
      }),
    );

    const ctx = makeCtx(flow);
    const result = await runFlow(dbWithAgentPrompt, ctx, null);

    expect(result.fatal_error).toBeUndefined();
    const call = openAiCreateMock.mock.calls[0]?.[0];
    const systemMessage = call?.messages?.find(
      (message: { role?: string }) => message.role === "system",
    );
    expect(systemMessage?.content).toContain("PROMPT GERAL CONFIGURADO");
    expect(systemMessage?.content).toContain("PROMPT LOCAL DO FLUXO");
    expect(systemMessage?.content.indexOf("PROMPT LOCAL DO FLUXO")).toBeLessThan(
      systemMessage?.content.indexOf("PROMPT GERAL CONFIGURADO") ?? -1,
    );
  });

  describe("shouldTriggerFlowFromInbound (PR 10, mai/2026)", () => {
    function makeEntry(
      trigger: FlowEntryNode["data"]["trigger"],
      config: Record<string, unknown> = {},
    ): FlowEntryNode {
      return {
        id: "entry-1",
        type: "entry",
        position: { x: 0, y: 0 },
        data: { label: "Entrada", trigger, config },
      };
    }

    it("conversation_started sempre dispara", () => {
      const entry = makeEntry("conversation_started");
      expect(shouldTriggerFlowFromInbound(entry, "qualquer texto")).toBe(true);
      expect(shouldTriggerFlowFromInbound(entry, "")).toBe(true);
    });

    it("keyword_match dispara apenas quando msg contém keyword (case-insensitive)", () => {
      const entry = makeEntry("keyword_match", {
        keywords: ["Comprar", "Agendar"],
      });
      expect(shouldTriggerFlowFromInbound(entry, "quero comprar um")).toBe(
        true,
      );
      expect(shouldTriggerFlowFromInbound(entry, "AGENDAR reunião")).toBe(true);
      expect(shouldTriggerFlowFromInbound(entry, "qual o preço?")).toBe(false);
    });

    it("keyword_match sem keywords cadastradas nunca dispara", () => {
      const entry = makeEntry("keyword_match", { keywords: [] });
      expect(shouldTriggerFlowFromInbound(entry, "comprar")).toBe(false);
    });

    it("segment_entered e pipeline_stage_entered NÃO disparam por inbound", () => {
      // Por design: esses triggers escutam eventos do CRM (segment
      // evaluator, kanban transition), não inbound WhatsApp.
      expect(
        shouldTriggerFlowFromInbound(
          makeEntry("segment_entered", { segment_id: "seg-1" }),
          "qualquer texto",
        ),
      ).toBe(false);
      expect(
        shouldTriggerFlowFromInbound(
          makeEntry("pipeline_stage_entered", { stage_id: "stage-1" }),
          "qualquer texto",
        ),
      ).toBe(false);
    });
  });

  it("PR-2: passa max_completion_tokens=4096 pro gpt-5* e max_tokens pro gpt-4o*", async () => {
    // Endereca rodada 6 #4: runner nao tinha cap por chamada LLM.
    // gpt-5* exige max_completion_tokens; gpt-4o* usa max_tokens.
    // Detectamos por prefixo do modelo.
    openAiCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: "ok", role: "assistant" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    // Mock DB suficiente pra loadAgentConfig + knowledge + cost-limits
    const dbForAi = {
      from: (table: string) => {
        const noop = {} as Record<string, unknown>;
        const chain: Record<string, unknown> = {};
        ["select", "eq", "neq", "in", "order", "limit", "is", "lte", "gte"].forEach((m) => {
          chain[m] = () => chain;
        });
        chain.maybeSingle = () => {
          if (table === "agent_configs") {
            return Promise.resolve({
              data: { model: "gpt-5-mini", system_prompt: "Voce e um agente." },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        };
        chain.single = () => Promise.resolve({ data: null, error: null });
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        Object.assign(noop, chain);
        return chain;
      },
    } as never;

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
            id: "ai-1",
            type: "ai_agent",
            position: { x: 200, y: 0 },
            data: {
              label: "IA",
              system_prompt: "",
              instructions: [],
            },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry-1",
            target: "ai-1",
            sourceHandle: "default",
          },
        ],
      }),
    );
    const ctx = makeCtx(flow);
    // dryRun=true mantem (skipa o ceiling check), mas o cap de
    // max_completion_tokens roda sempre.
    await runFlow(dbForAi, ctx, null);

    // Confirmar que OpenAI foi chamado com max_completion_tokens=4096
    expect(openAiCreateMock).toHaveBeenCalledTimes(1);
    const callArgs = openAiCreateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).toMatchObject({
      model: "gpt-5-mini",
      max_completion_tokens: 4096,
    });
    expect(callArgs.max_tokens).toBeUndefined();
  });

  it("PR-2: gpt-4o usa max_tokens (nao max_completion_tokens)", async () => {
    openAiCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: "ok", role: "assistant" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const dbForAi = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        ["select", "eq", "neq", "in", "order", "limit", "is", "lte", "gte"].forEach((m) => {
          chain[m] = () => chain;
        });
        chain.maybeSingle = () => {
          if (table === "agent_configs") {
            return Promise.resolve({
              data: { model: "gpt-4o-mini", system_prompt: "" },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        };
        chain.single = () => Promise.resolve({ data: null, error: null });
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain;
      },
    } as never;

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
            id: "ai-1",
            type: "ai_agent",
            position: { x: 200, y: 0 },
            data: { label: "IA", system_prompt: "", instructions: [] },
          },
        ],
        edges: [{ id: "e1", source: "entry-1", target: "ai-1", sourceHandle: "default" }],
      }),
    );
    const ctx = makeCtx(flow);
    await runFlow(dbForAi, ctx, null);

    const callArgs = openAiCreateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).toMatchObject({
      model: "gpt-4o-mini",
      max_tokens: 4096,
    });
    expect(callArgs.max_completion_tokens).toBeUndefined();
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
