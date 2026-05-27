// PR-5 Auditoria (mai/2026) — testes do contexto enriquecido de handlers.
//
// Endereca rodada 4 #critica do POST_CODEX_AUDIT: handlers nativos
// falhavam com "database context missing" porque runner.ts construia
// contexto minimo. Agora `buildNativeHandlerContext` injeta db +
// provider + config + agentConversation + openaiClient.
//
// Tambem cobre a reescrita de transfer_to_agent (rodada 4 #critica)
// pro modelo flow (config_id swap + reset current_node_id +
// bump epoch, sem agent_stages).

import { describe, expect, it, vi } from "vitest";
import type { AgentConfig, AgentConversation } from "@persia/shared/ai-agent";
import { buildNativeHandlerContext } from "@/lib/ai-agent/flow/handler-context";
import { transferToAgentHandler } from "@/lib/ai-agent/tools/transfer-to-agent";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";
import type { FlowRunContext } from "@/lib/ai-agent/flow/types";

vi.mock("server-only", () => ({}));

function makeFlowCtx(overrides: Partial<FlowRunContext> = {}): FlowRunContext {
  return {
    flow: { id: "f1", agent_config_id: "cfg-1", organization_id: "org-1", version: 1, config: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, enabled_tools: [] } },
    agentConfigId: "cfg-1",
    organizationId: "org-1",
    crmConversationId: "crm-conv-1",
    agentConversationId: "agent-conv-1",
    leadId: "lead-1",
    inboundMessage: { text: "oi", received_at: new Date().toISOString() },
    provider: { emit: vi.fn(), getEvents: () => [] },
    dryRun: false,
    flowConfig: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, enabled_tools: [] },
    ...overrides,
  };
}

describe("PR-5 buildNativeHandlerContext (rodada 4 #critica)", () => {
  it("injeta db + ids basicos do FlowRunContext", () => {
    const db = { from: vi.fn() } as never;
    const ctx = makeFlowCtx();
    const handlerCtx = buildNativeHandlerContext(db, ctx);

    expect(handlerCtx.db).toBe(db);
    expect(handlerCtx.organization_id).toBe("org-1");
    expect(handlerCtx.lead_id).toBe("lead-1");
    expect(handlerCtx.crm_conversation_id).toBe("crm-conv-1");
    expect(handlerCtx.agent_conversation_id).toBe("agent-conv-1");
    expect(handlerCtx.dry_run).toBe(false);
  });

  it("propaga agentConfig + agentConversation + provider + openaiClient da FlowRunContext", () => {
    const db = { from: vi.fn() } as never;
    const fakeConfig = { id: "cfg-1", name: "Agente Vendas" } as AgentConfig;
    const fakeConv = { id: "agent-conv-1", history_summary: "lead quer R$ 50k" } as AgentConversation;
    const fakeProvider = { name: "uazapi", sendText: vi.fn() } as never;
    const fakeOpenai = {} as never;
    const ctx = makeFlowCtx({
      agentConfig: fakeConfig,
      agentConversation: fakeConv,
      whatsappProvider: fakeProvider,
      openaiClient: fakeOpenai,
    });

    const handlerCtx = buildNativeHandlerContext(db, ctx);

    expect(handlerCtx.config).toBe(fakeConfig);
    expect(handlerCtx.agentConversation).toBe(fakeConv);
    expect(handlerCtx.provider).toBe(fakeProvider);
    expect(handlerCtx.openaiClient).toBe(fakeOpenai);
  });

  it("aceita overrides via extras (handler pode customizar contexto)", () => {
    const db = { from: vi.fn() } as never;
    const overrideConfig = { id: "cfg-other" } as AgentConfig;
    const ctx = makeFlowCtx({
      agentConfig: { id: "cfg-original" } as AgentConfig,
    });

    const handlerCtx = buildNativeHandlerContext(db, ctx, {
      config: overrideConfig,
      runId: "run-123",
      stepOrderIndex: 5,
    });

    expect(handlerCtx.config).toBe(overrideConfig);
    expect(handlerCtx.run_id).toBe("run-123");
    expect(handlerCtx.stepOrderIndex).toBe(5);
  });

  it("preserva dry_run da FlowRunContext", () => {
    const db = { from: vi.fn() } as never;
    const ctx = makeFlowCtx({ dryRun: true });
    const handlerCtx = buildNativeHandlerContext(db, ctx);
    expect(handlerCtx.dry_run).toBe(true);
  });
});

describe("PR-5 transfer_to_agent reescrito pro modelo flow (rodada 4 #critica)", () => {
  it("swap config_id + reset current_node_id + bump epoch + preserva history_summary", async () => {
    const supabase = createSupabaseMock();
    // 1. SELECT current agent_conversation
    supabase.queue("agent_conversations", {
      data: {
        config_id: "cfg-old",
        current_node_id: "node-mid-flow",
        history_summary: "lead pediu desconto",
        variables: { name: "Joao" },
        ai_control_epoch: 3,
      },
      error: null,
    });
    // 2. SELECT target agent_config by name (ilike)
    supabase.queue("agent_configs", {
      data: { id: "cfg-new" },
      error: null,
    });
    // 3. SELECT agent_flows pra validar que target tem flow
    supabase.queue("agent_flows", {
      data: { id: "flow-new" },
      error: null,
    });

    const result = await transferToAgentHandler(
      {
        organization_id: "org-1",
        lead_id: "lead-1",
        crm_conversation_id: "crm-conv-1",
        agent_conversation_id: "agent-conv-1",
        run_id: "",
        dry_run: false,
        db: supabase as never,
      } as never,
      { target_agent_name: "Agente Suporte", reason: "lead reclamou de produto" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      old_config_id: "cfg-old",
      new_config_id: "cfg-new",
      old_node_id: "node-mid-flow",
      new_node_id: null,
      preserved_history_summary: true,
      preserved_variables: true,
      epoch_bumped: true,
    });

    // Verifica UPDATE: novo config_id, current_node_id=null, epoch+1.
    const updates = supabase.updates.agent_conversations as Array<Record<string, unknown>>;
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      config_id: "cfg-new",
      current_node_id: null,
      ai_control_epoch: 4, // bumped from 3
    });
  });

  it("falha se agente alvo nao tem flow materializado", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: {
        config_id: "cfg-old",
        current_node_id: null,
        history_summary: null,
        variables: {},
        ai_control_epoch: 0,
      },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: { id: "cfg-no-flow" },
      error: null,
    });
    // agent_flows query retorna null
    supabase.queue("agent_flows", { data: null, error: null });

    const result = await transferToAgentHandler(
      {
        organization_id: "org-1",
        lead_id: "lead-1",
        crm_conversation_id: "crm-conv-1",
        agent_conversation_id: "agent-conv-1",
        run_id: "",
        dry_run: false,
        db: supabase as never,
      } as never,
      { target_agent_name: "Agente Sem Flow" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("no flow configured");
    expect(supabase.updates.agent_conversations).toBeUndefined();
  });

  it("dry_run nao muta DB (smoke test paridade com producao)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: {
        config_id: "cfg-old",
        current_node_id: "node-x",
        history_summary: null,
        variables: {},
        ai_control_epoch: 0,
      },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: { id: "cfg-new" },
      error: null,
    });
    supabase.queue("agent_flows", {
      data: { id: "flow-new" },
      error: null,
    });

    const result = await transferToAgentHandler(
      {
        organization_id: "org-1",
        lead_id: "lead-1",
        crm_conversation_id: "crm-conv-1",
        agent_conversation_id: "agent-conv-1",
        run_id: "",
        dry_run: true,
        db: supabase as never,
      } as never,
      { target_agent_name: "Agente B" },
    );

    expect(result.success).toBe(true);
    // dry_run NAO chama UPDATE
    expect(supabase.updates.agent_conversations).toBeUndefined();
  });
});
