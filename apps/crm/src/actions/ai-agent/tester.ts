"use server";

// PR-FLOW-PIVOT (mai/2026): runtime velho (executor.ts + tester-context.ts)
// removido. Este arquivo virou STUB enquanto o flow runtime (PR 2) não
// aterrissa. Todas as funções retornam erro 503 "AI Agent em migração pra
// novo runtime (flow canvas)". UI do TesterSheet mostra mensagem amigável.
//
// Mantém as assinaturas idênticas pras chamadas existentes (rotas API
// + adapters do ai-agent-ui) continuarem compilando. PR 2 substitui
// pelo flow runtime real.

import type {
  TesterLiveRequest,
  TesterLiveResponse,
  TesterRequest,
  TesterResponse,
} from "@persia/shared/ai-agent";

const STUB_ERROR_MSG =
  "AI Agent em migração pra novo runtime (flow canvas). Tester volta no PR 2 do pivot.";

export async function testAgent(_req: TesterRequest): Promise<TesterResponse> {
  return {
    run_id: "",
    status: "failed",
    assistant_reply: "",
    steps: [],
    tokens_used: 0,
    cost_usd_cents: 0,
    next_node_id: null,
    error: STUB_ERROR_MSG,
  };
}

export async function testAgentLive(
  _req: TesterLiveRequest,
): Promise<TesterLiveResponse> {
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
    error: STUB_ERROR_MSG,
  };
}

export async function resetTesterConversation(): Promise<{ ok: true }> {
  // No-op até o flow runtime + tester-context novo aparecerem (PR 2).
  return { ok: true };
}
