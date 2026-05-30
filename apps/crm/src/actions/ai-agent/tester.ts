"use server";

// AI Agent — Tester actions.
//
// PR-FLOW-PIVOT PR 2 (mai/2026): substitui o stub 503 do PR 1.
// `testAgent` (legado single-shot) e `testAgentLive` (pipeline fiel)
// agora rodam o novo flow-runner contra o lead/conversation de teste,
// com provider stub capturando eventos em memória.
//
// `testAgent` foi simplificado: chama `testAgentLive` internamente e
// adapta o shape de retorno. UI antiga que ainda usa testAgent continua
// funcionando.

import type {
  TesterEvent,
  TesterLiveRequest,
  TesterLiveResponse,
  TesterRequest,
  TesterResponse,
  TesterSimulateEventRequest,
} from "@persia/shared/ai-agent";
import {
  calculateCostUsdCents,
  findEntryNode,
  normalizeHumanizationConfig,
} from "@persia/shared/ai-agent";
import { asAgentDb } from "@/lib/ai-agent/db";
import { loadFlowByConfigId } from "@/lib/ai-agent/flow/loader";
import { runFlow } from "@/lib/ai-agent/flow/runner";
import {
  ensureTesterContext,
  persistCurrentNode,
  resetTesterConversation as resetTesterImpl,
} from "@/lib/ai-agent/flow/tester-context";
import { collectGateWarnings } from "@/lib/ai-agent/flow/tester-gates";
import { createTesterProvider } from "@/lib/ai-agent/flow/tester-provider";
import type {
  FlowProviderStub,
  FlowRunContext,
  TesterRunEvent,
} from "@/lib/ai-agent/flow/types";
import { requireAgentRole } from "./utils";

// ============================================================================
// testAgentLive — pipeline fiel
// ============================================================================

export async function testAgentLive(
  req: TesterLiveRequest,
): Promise<TesterLiveResponse> {
  const { supabase, orgId } = await requireAgentRole("agent");
  const db = asAgentDb(supabase);

  try {
    // 1. Resolve agent_config + flow.
    //
    // Backlog #6 Auditoria (mai/2026): SELECT estende status + model pra
    // gate_warnings (rodada 10 #2) + cost real (rodada 10 #3). UI tester
    // antes reportava cost_usd_cents=0 mesmo gastando OpenAI real.
    const { data: agentConfig, error: configError } = await db
      .from("agent_configs")
      .select("id, status, model, humanization_config")
      .eq("organization_id", orgId)
      .eq("id", req.config_id)
      .maybeSingle();
    if (configError || !agentConfig) {
      return failedResponse("Agente não encontrado");
    }
    const cfg = agentConfig as {
      status?: string;
      model?: string;
      humanization_config?: unknown;
    };
    const humanizationConfig = normalizeHumanizationConfig(cfg.humanization_config);
    const model = cfg.model ?? "gpt-5-mini";

    const flow = await loadFlowByConfigId(db, orgId, req.config_id);
    if (!flow) {
      return failedResponse(
        "Agente sem fluxo configurado. Recrie a partir de um template ou edite o canvas.",
      );
    }

    // 1b. Coleta gate_warnings — paridade tester × prod (rodada 10 #2).
    // Tester NUNCA bloqueia, apenas avisa o admin "esse run nao reflete
    // o que aconteceria em prod hoje". Producao gateia em executor.ts.
    const gateWarnings = await collectGateWarnings(db, orgId, cfg.status, humanizationConfig);

    // 2. Garante lead/conversation/agent_conversation de teste
    const tester = await ensureTesterContext(db, orgId, req.config_id);

    // 3. Provider stub + contexto de execução
    const provider = createTesterProvider();
    const ctx: FlowRunContext = {
      flow,
      agentConfigId: req.config_id,
      organizationId: orgId,
      crmConversationId: tester.crmConversationId,
      agentConversationId: tester.agentConversationId,
      leadId: tester.leadId,
      inboundMessage: {
        text: req.message,
        received_at: new Date().toISOString(),
      },
      provider,
      dryRun: true,
      flowConfig: flow.config,
    };

    // 4. Roda o flow a partir do current_node_id atual
    const result = await runFlow(db, ctx, tester.currentNodeId);

    // 5. Persiste ending_node_id (mesmo se aborted, salvamos pra debug)
    await persistCurrentNode(
      db,
      orgId,
      tester.agentConversationId,
      result.ending_node_id,
    );

    // 6. Converte FlowRunEvent → TesterEvent (subset compatível com UI)
    const uiEvents: TesterEvent[] = result.events
      .filter(isUiVisibleEvent)
      .map((e) => ({ ts: e.ts, kind: mapEventKind(e.kind), payload: e.payload }));

    // 7. Cost real (rodada 10 #3): tokens vem do runner que somou todos os
    // ping-pong do AI node; cost via MODEL_PRICING.
    const tokensTotal = result.tokens_input + result.tokens_output;
    const costCents = calculateCostUsdCents(
      model,
      result.tokens_input,
      result.tokens_output,
    );

    return {
      run_id: null,
      events: uiEvents,
      steps: [],
      next_node_id: result.ending_node_id,
      tokens_used: tokensTotal,
      cost_usd_cents: costCents,
      applied_config: {
        split_enabled: humanizationConfig.split_enabled,
        split_threshold_chars: humanizationConfig.split_threshold_chars,
        split_delay_seconds: humanizationConfig.split_delay_seconds,
        business_hours_enabled: humanizationConfig.business_hours_enabled,
        pause_keywords: humanizationConfig.pause_keywords,
        resume_keywords: humanizationConfig.resume_keywords,
      },
      ...(gateWarnings.length > 0 ? { gate_warnings: gateWarnings } : {}),
      ...(result.fatal_error ? { error: result.fatal_error } : {}),
    };
  } catch (err) {
    return failedResponse(err instanceof Error ? err.message : String(err));
  }
}

// ============================================================================
// simulateCrmEvent — PR-FLOW-PIVOT PR 16 (mai/2026)
// ============================================================================
//
// Dispara o flow do entry node com synthetic empty inbound, replicando
// o que o runtime real faria quando hook de stage/segment entry dispara.
// Valida que o trigger_type + target_id casam com a entry node config —
// senão retorna skipped pra deixar claro que em prod NÃO dispararia.

export async function simulateCrmEvent(
  req: TesterSimulateEventRequest,
): Promise<TesterLiveResponse> {
  const { supabase, orgId } = await requireAgentRole("agent");
  const db = asAgentDb(supabase);

  try {
    // 1. Carrega agent_config (status + model + humanization_config) — espelha
    // padrao do testAgentLive pra coletar gate_warnings e calcular custo
    // real. Sem reuse direto porque simulateCrmEvent tem branch extra de
    // validacao do entry node antes de rodar.
    const { data: agentConfig, error: configError } = await db
      .from("agent_configs")
      .select("id, status, model, humanization_config")
      .eq("organization_id", orgId)
      .eq("id", req.config_id)
      .maybeSingle();
    if (configError || !agentConfig) {
      return failedResponse("Agente não encontrado");
    }
    const cfg = agentConfig as {
      status?: string;
      model?: string;
      humanization_config?: unknown;
    };
    const humanizationConfig = normalizeHumanizationConfig(cfg.humanization_config);
    const model = cfg.model ?? "gpt-5-mini";

    const flow = await loadFlowByConfigId(db, orgId, req.config_id);
    if (!flow) {
      return failedResponse(
        "Agente sem fluxo configurado. Adicione uma entrada (entry node) primeiro.",
      );
    }
    const entry = findEntryNode(flow.config);
    if (!entry) {
      return failedResponse("Fluxo sem entry node — adicione uma entrada.");
    }
    if (entry.data.trigger !== req.trigger_type) {
      const triggerLabel =
        req.trigger_type === "pipeline_stage_entered"
          ? "Entrou em etapa do funil"
          : "Entrou em segmentação";
      return failedResponse(
        `Esse fluxo tem entrada do tipo "${entry.data.trigger}", não "${req.trigger_type}". Mude a entrada pra "${triggerLabel}" pra simular esse evento.`,
      );
    }
    const config = entry.data.config ?? {};
    const expectedTargetId =
      req.trigger_type === "pipeline_stage_entered"
        ? (config.stage_id as string | undefined)
        : (config.segment_id as string | undefined);
    if (!expectedTargetId) {
      return failedResponse(
        "Entry node não tem alvo configurado (stage_id ou segment_id). Edite no canvas e selecione um alvo.",
      );
    }
    if (expectedTargetId !== req.target_id) {
      const targetType =
        req.trigger_type === "pipeline_stage_entered" ? "etapa" : "segmentação";
      return {
        run_id: null,
        events: [],
        skipped: "other",
        steps: [],
        next_node_id: null,
        tokens_used: 0,
        cost_usd_cents: 0,
        applied_config: {
          split_enabled: humanizationConfig.split_enabled,
          split_threshold_chars: humanizationConfig.split_threshold_chars,
          split_delay_seconds: humanizationConfig.split_delay_seconds,
          business_hours_enabled: humanizationConfig.business_hours_enabled,
          pause_keywords: humanizationConfig.pause_keywords,
          resume_keywords: humanizationConfig.resume_keywords,
        },
        error: `Em produção esse fluxo não dispararia: a ${targetType} simulada não é a configurada na entrada.`,
      };
    }

    // 1b. Coleta gate_warnings — paridade tester × prod.
    const gateWarnings = await collectGateWarnings(db, orgId, cfg.status, humanizationConfig);

    // 2. Garante lead/conversation/agent_conversation de teste.
    const tester = await ensureTesterContext(db, orgId, req.config_id);

    // 3. Provider stub + contexto com inbound VAZIO (evento CRM não
    // tem msg do lead). Runner detecta empty + skipa AI node graciously.
    const provider = createTesterProvider();
    const ctx: FlowRunContext = {
      flow,
      agentConfigId: req.config_id,
      organizationId: orgId,
      crmConversationId: tester.crmConversationId,
      agentConversationId: tester.agentConversationId,
      leadId: tester.leadId,
      inboundMessage: {
        text: "",
        received_at: new Date().toISOString(),
      },
      provider,
      dryRun: true,
      flowConfig: flow.config,
    };

    // 4. Force start do entry (null) — evento é discreto, não continua
    // de turno anterior.
    const result = await runFlow(db, ctx, null);

    // 5. Persiste ending_node_id pra debug.
    await persistCurrentNode(
      db,
      orgId,
      tester.agentConversationId,
      result.ending_node_id,
    );

    // 6. Mapeia eventos pro shape compatível com UI.
    const uiEvents: TesterEvent[] = result.events
      .filter(isUiVisibleEvent)
      .map((e) => ({ ts: e.ts, kind: mapEventKind(e.kind), payload: e.payload }));

    const tokensTotal = result.tokens_input + result.tokens_output;
    const costCents = calculateCostUsdCents(
      model,
      result.tokens_input,
      result.tokens_output,
    );

    return {
      run_id: null,
      events: uiEvents,
      steps: [],
      next_node_id: result.ending_node_id,
      tokens_used: tokensTotal,
      cost_usd_cents: costCents,
      applied_config: {
        split_enabled: humanizationConfig.split_enabled,
        split_threshold_chars: humanizationConfig.split_threshold_chars,
        split_delay_seconds: humanizationConfig.split_delay_seconds,
        business_hours_enabled: humanizationConfig.business_hours_enabled,
        pause_keywords: humanizationConfig.pause_keywords,
        resume_keywords: humanizationConfig.resume_keywords,
      },
      ...(gateWarnings.length > 0 ? { gate_warnings: gateWarnings } : {}),
      ...(result.fatal_error ? { error: result.fatal_error } : {}),
    };
  } catch (err) {
    return failedResponse(err instanceof Error ? err.message : String(err));
  }
}

// ============================================================================
// testAgent — wrapper legado (single-shot). Compat com TesterRequest.
// ============================================================================

export async function testAgent(req: TesterRequest): Promise<TesterResponse> {
  const live = await testAgentLive({
    config_id: req.config_id,
    message: req.message,
    expedite_debounce: true,
  });

  return {
    run_id: live.run_id ?? "",
    status: live.error ? "failed" : "succeeded",
    assistant_reply: extractAssistantReply(live.events),
    steps: live.steps,
    tokens_used: live.tokens_used,
    cost_usd_cents: live.cost_usd_cents,
    next_node_id: live.next_node_id,
    ...(live.error ? { error: live.error } : {}),
  };
}

// ============================================================================
// resetTesterConversation — botão "Resetar" na UI
// ============================================================================

export async function resetTesterConversation(): Promise<{ ok: true }> {
  const { supabase, orgId } = await requireAgentRole("agent");
  const db = asAgentDb(supabase);
  await resetTesterImpl(db, orgId);
  return { ok: true };
}

// ============================================================================
// Helpers
// ============================================================================

function failedResponse(message: string): TesterLiveResponse {
  return {
    run_id: null,
    events: [],
    skipped: "other",
    steps: [],
    next_node_id: null,
    tokens_used: 0,
    cost_usd_cents: 0,
    applied_config: {
      split_enabled: false,
      split_threshold_chars: 0,
      split_delay_seconds: 0,
      business_hours_enabled: false,
      pause_keywords: [],
      resume_keywords: [],
    },
    error: message,
  };
}

const UI_VISIBLE_KINDS = new Set<TesterRunEvent["kind"]>([
  "send_text",
  "set_typing_on",
  "set_typing_off",
  "send_media",
  "tool_result",
  "skipped",
]);

function isUiVisibleEvent(event: TesterRunEvent): boolean {
  return UI_VISIBLE_KINDS.has(event.kind);
}

function mapEventKind(kind: TesterRunEvent["kind"]): TesterEvent["kind"] {
  // Restringe kinds internos a um subset que o shared TesterEvent aceita.
  // Eventos internos (node_entered, llm_call, tool_call) não passam.
  switch (kind) {
    case "send_text":
      return "send_text";
    case "set_typing_on":
      return "set_typing_on";
    case "set_typing_off":
      return "set_typing_off";
    case "send_media":
      return "send_media";
    case "tool_result":
      return "tool_result";
    case "skipped":
      return "skipped";
    default:
      return "skipped"; // fallback defensivo — não deve atingir por causa do filter acima
  }
}

function extractAssistantReply(events: TesterEvent[]): string {
  const texts: string[] = [];
  for (const e of events) {
    if (e.kind === "send_text") {
      const msg = (e.payload as { message?: string }).message;
      if (msg) texts.push(msg);
    }
  }
  return texts.join("\n");
}

// Suprime warnings de imports tipo-only que TypeScript pode marcar:
type _UnusedRef = FlowProviderStub;
