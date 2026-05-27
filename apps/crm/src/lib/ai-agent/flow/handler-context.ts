// PR-5 Auditoria (mai/2026) — endereca rodada 4 #critica:
// handlers nativos sem `db` injection. O dispatch em runner.ts construia
// um contexto minimo com apenas ids basicos (organization_id, lead_id,
// crm_conversation_id, agent_conversation_id, run_id, dry_run). Handlers
// que chamavam `getHandlerDb(context)` recebiam null e falhavam com
// "database context missing" — quebrava add_tag, move_pipeline_stage,
// transfer_to_user, set_lead_custom_field, send_media, trigger_notification,
// stop_agent, round_robin_user, transfer_to_agent.
//
// Este modulo centraliza a construcao do contexto com TODOS os extras
// que os handlers podem precisar:
//   - db (AgentDb): para SELECT/INSERT/UPDATE
//   - provider (WhatsAppProvider): para send_media, trigger_notification
//   - config (AgentConfig): para stop_agent (handoff_notification template),
//     trigger_notification (target email/whatsapp), humanization
//   - agentConversation (AgentConversation): para stop_agent (history_summary),
//     transfer_to_agent (config_id swap)
//   - openaiClient: para meta-IA como handoff brief em stop_agent
//
// Tambem unifica `dry_run` — passado ao handler que cada um respeita
// internamente (handler decide o que e mutacao vs. apenas SELECT).

import "server-only";

import OpenAI from "openai";
import type {
  AgentConfig,
  AgentConversation,
} from "@persia/shared/ai-agent";
import type { WhatsAppProvider } from "@persia/shared/whatsapp";
import type { AgentDb } from "../db";
import type { HandlerContextWithDb } from "../tools/shared";
import type { FlowRunContext } from "./types";

export interface NativeHandlerExtras {
  /** Override pontual — se nao passar, usa ctx.agentConfig. */
  config?: AgentConfig;
  /** Override pontual — se nao passar, usa ctx.agentConversation. */
  agentConversation?: AgentConversation;
  /** Override pontual — se nao passar, usa ctx.whatsappProvider. */
  provider?: WhatsAppProvider | null;
  /** Override pontual — se nao passar, usa ctx.openaiClient. */
  openaiClient?: OpenAI | null;
  /** ID do agent_runs corrente (audit). Vazio se nao habilitado. */
  runId?: string;
  /** Ordem do step dentro do run (audit log). */
  stepOrderIndex?: number;
}

/**
 * Constroi o contexto que o handler nativo recebe. Caller passa o `db`
 * explicitamente (runner.ts ja tem o handle no escopo) + qualquer extra
 * que queira sobrescrever. Resto vem da FlowRunContext.
 */
export function buildNativeHandlerContext(
  db: AgentDb,
  ctx: FlowRunContext,
  extras: NativeHandlerExtras = {},
): HandlerContextWithDb {
  return {
    organization_id: ctx.organizationId,
    lead_id: ctx.leadId ?? "",
    crm_conversation_id: ctx.crmConversationId ?? "",
    agent_conversation_id: ctx.agentConversationId,
    run_id: extras.runId ?? "",
    dry_run: ctx.dryRun,
    db,
    provider: extras.provider ?? ctx.whatsappProvider ?? null,
    config: extras.config ?? ctx.agentConfig,
    agentConversation: extras.agentConversation ?? ctx.agentConversation,
    openaiClient: extras.openaiClient ?? ctx.openaiClient ?? null,
    stepOrderIndex: extras.stepOrderIndex,
  };
}
