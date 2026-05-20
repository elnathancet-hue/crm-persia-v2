// AI Agent — executor STUB durante PR-FLOW-PIVOT (mai/2026).
//
// O runtime antigo (~1500 linhas) foi removido junto com o modelo de
// stages/auto_actions. O novo runtime vive em flow-executor.ts (PR 2
// do pivot) e interpreta nodes/edges do canvas. Este arquivo existe
// SÓ pra manter os webhooks WhatsApp + debounce-flush compilando até
// o flow runtime aterrissar.
//
// Comportamento: `tryEnqueueForNativeAgent` sempre retorna
// `{ handled: false }` → webhook cai no pipeline legacy (n8n/OpenAI).
// Tester recebe 503 nos endpoints — UI mostra mensagem amigável.
//
// REMOVER este stub no PR 2 e re-exportar tryEnqueueForNativeAgent
// do flow-executor.ts com a mesma assinatura.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@persia/shared";
import type { IncomingMessage, WhatsAppProvider } from "@persia/shared/whatsapp";

/** Shape do retorno do enqueue — mantido idêntico ao runtime antigo pra
 * webhook + debounce-flush continuarem compilando. Os campos opcionais
 * são exatamente os mesmos que o caller (route.ts) inspeciona. */
export interface NativeAgentResponseShape {
  ok?: boolean;
  skipped?: string;
  handledBy?: string;
  leadId?: string | null;
  conversationId?: string | null;
  status?: string;
  runId?: string;
}

export interface TryEnqueueOutcome {
  handled: boolean;
  response: NativeAgentResponseShape;
}

export interface TryEnqueueInput {
  supabase: SupabaseClient<Database>;
  orgId: string;
  provider: WhatsAppProvider;
  msg: IncomingMessage;
  requestId: string;
}

/**
 * STUB: sempre devolve `{ handled: false }` durante o pivot.
 * Webhook cai no pipeline legacy (n8n/OpenAI) — comportamento idêntico
 * a quando uma org não tem AI Agent ativo.
 */
export async function tryEnqueueForNativeAgent(
  _input: TryEnqueueInput,
): Promise<TryEnqueueOutcome> {
  return {
    handled: false,
    response: { ok: false, skipped: "ai_agent_flow_pivot_in_progress" },
  };
}

/**
 * STUB: chamado pelo cron /api/ai-agent/debounce-flush. Sem flow runtime
 * implementado, não há nada a flushar. Retorna lista vazia.
 */
export async function flushReadyConversations(): Promise<{
  processed: number;
  errors: string[];
}> {
  return { processed: 0, errors: [] };
}

/**
 * STUB: assinatura mantida pra debounce.ts compilar. Sempre retorna
 * runId=null + status='skipped'. PR 2 substitui pelo flow runtime.
 */
export async function executeDebouncedBatch(_input: {
  db: unknown;
  orgId: string;
  batch: unknown;
  requestId?: string;
}): Promise<{ runId: string | null; status: "skipped" | "succeeded" | "failed" }> {
  return { runId: null, status: "skipped" };
}
