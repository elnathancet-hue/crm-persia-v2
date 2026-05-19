import "server-only";

import type {
  AgentFollowup,
  AgentNotificationTemplate,
  NotificationFixedVariables,
} from "@persia/shared/ai-agent";
import { renderNotificationTemplate } from "@persia/shared/ai-agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createProvider } from "@/lib/whatsapp/providers";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import { errorMessage, logError, logInfo } from "@/lib/observability";
import { asAgentDb, type AgentDb } from "../db";
import { buildNotificationWaLink } from "../notifications";

// PR4 (mai/2026): runtime real de agent_followups. Antes desta PR
// schema (027), UI (CRUD em apps/crm/src/actions/ai-agent/followups.ts)
// e modelo de domain (packages/shared/src/ai-agent/followups.ts) ja
// estavam prontos — mas nenhum cron tickava. Cliente configurava
// "Avisar lead 24h sem resposta" e nada acontecia.
//
// PIPELINE
// --------
// 1. Carrega TODOS os agent_followups com is_enabled=true (cross-org,
//    service role bypassa RLS).
// 2. Pra cada followup: encontra agent_conversations que:
//    - pertencem ao mesmo config_id
//    - last_interaction_at < now() - delay_hours
//    - human_handoff_at IS NULL (humano assumiu, nao spamar)
//    - NAO tem row em agent_followup_runs pra (followup_id, conv_id)
// 3. Pra cada conversation match:
//    a. INSERT em agent_followup_runs ANTES de qualquer side effect
//       (UNIQUE(followup_id, conversation_id) garante que 2 ticks
//       concorrentes nao disparam pro mesmo lead 2x — o segundo cai
//       em 23505 e a iteracao pula).
//    b. Carrega lead.phone + template.body_template.
//    c. Renderiza body com vars do lead + agent.
//    d. provider.sendText pra lead.phone (NAO pra template.target_address —
//       template aqui e usado so como corpo da mensagem reutilizavel;
//       destino e sempre o lead).
// 4. Stats agregadas no retorno.
//
// LIMITES E TRADE-OFFS
// --------------------
// - **Sem business_hours check**: o tick pode disparar 3am se a janela
//   bate. Mitigacao do cliente: configurar delays compativeis ("48h"
//   em vez de "24h" pra evitar madrugada). TODO follow-up: integrar
//   isWithinBusinessHours via humanization_config do agent_config.
// - **last_interaction_at e atualizado em QUALQUER atividade**, nao so
//   inbound do lead. Se o agente respondeu HA POUCO, o relogio reinicia.
//   Isso e OK pro caso "lembrete X horas sem resposta" porque dura: lead
//   respondeu => relogio zera; agente respondeu mas lead nao => relogio
//   zera tambem (potencial false negative). Refinamento futuro: campo
//   separado last_inbound_message_at.
// - **MAX_PROCESSED_PER_TICK**: limita carga por tick. Em escala alta,
//   adicionar pagination/cursor. Hoje: 200 conversas por tick comfortable.
// - **Cleanup de agent_followup_runs**: nao implementado aqui. Migration
//   027 sugere >90d. Pode virar job de manutencao depois.

const MAX_PROCESSED_PER_TICK = 200;

const DEFAULT_APP_URL = "https://crm.funilpersia.top";

// ============================================================================
// Tipos do tick result
// ============================================================================

export interface FollowupTickResult {
  started_at: string;
  finished_at: string;
  /** Total de followups (is_enabled=true) carregados em todas as orgs. */
  followups_loaded: number;
  /** Total de conversations que matcharam (antes de filtrar idempotency). */
  conversations_matched: number;
  /** Quantos disparos efetivos (INSERT + sendText ok). */
  fired: number;
  /** Skipados por idempotency (insert deu UNIQUE violation = outro tick
   * fez antes, ou lead sem phone, ou agent_config arquivado, etc). */
  skipped: number;
  /** Erros recuperaveis (insert ok mas sendText falhou — log sem rollback;
   * a row em agent_followup_runs fica pra evitar retry-spam). */
  errors: number;
  /** Amostras de erros pra debug rapido sem precisar do log central. */
  error_samples: Array<{
    followup_id: string;
    conversation_id: string;
    error: string;
  }>;
}

function idleResult(now: Date): FollowupTickResult {
  const iso = now.toISOString();
  return {
    started_at: iso,
    finished_at: iso,
    followups_loaded: 0,
    conversations_matched: 0,
    fired: 0,
    skipped: 0,
    errors: 0,
    error_samples: [],
  };
}

// ============================================================================
// Entry point
// ============================================================================

export async function runFollowupsTick(
  db: AgentDb = asAgentDb(createAdminClient()),
): Promise<FollowupTickResult> {
  const startedAt = new Date();
  const result = idleResult(startedAt);

  const followups = await loadEnabledFollowups(db);
  result.followups_loaded = followups.length;
  if (followups.length === 0) {
    result.finished_at = new Date().toISOString();
    return result;
  }

  // Cache de provider por org — evita carregar varias vezes quando varios
  // followups da mesma org disparam no mesmo tick. Tambem cacheamos null
  // pra orgs SEM whatsapp_connections (skip rapido nas proximas
  // iteracoes).
  const providerCache = new Map<string, WhatsAppProvider | null>();
  // Cache de agent_configs.name + status pra render de vars + skip de
  // configs arquivados.
  const configCache = new Map<string, { name: string; status: string } | null>();

  for (const followup of followups) {
    if (result.fired + result.skipped + result.errors >= MAX_PROCESSED_PER_TICK) {
      // Atingiu o cap deste tick — proximo tick continua.
      break;
    }

    const config = await getOrLoadConfig(db, followup.organization_id, followup.config_id, configCache);
    if (!config || config.status !== "active") {
      // Config arquivado ou nao encontrado — skip todo o followup.
      continue;
    }

    const template = await loadTemplateForFollowup(db, followup);
    if (!template || template.status !== "active") {
      // Template removido ou arquivado — skip.
      continue;
    }

    const due = await loadDueConversations(db, followup);
    result.conversations_matched += due.matchedCount;
    if (due.pending.length === 0) continue;

    const provider = await getOrLoadProvider(db, followup.organization_id, providerCache);
    if (!provider) {
      // Org sem WhatsApp conectado — skip os matches. Cliente vai conectar
      // antes do proximo tick.
      result.skipped += due.pending.length;
      continue;
    }

    for (const conv of due.pending) {
      if (result.fired + result.skipped + result.errors >= MAX_PROCESSED_PER_TICK) break;

      const outcome = await dispatchFollowup({
        db,
        followup,
        template,
        agentName: config.name,
        conversation: conv,
        provider,
      });
      if (outcome.fired) {
        result.fired++;
      } else if (outcome.error) {
        result.errors++;
        if (result.error_samples.length < 5) {
          result.error_samples.push({
            followup_id: followup.id,
            conversation_id: conv.id,
            error: outcome.error,
          });
        }
      } else {
        result.skipped++;
      }
    }
  }

  result.finished_at = new Date().toISOString();
  logInfo("ai_agent_followups_tick_completed", {
    organization_id: null,
    request_id: null,
    followups_loaded: result.followups_loaded,
    conversations_matched: result.conversations_matched,
    fired: result.fired,
    skipped: result.skipped,
    errors: result.errors,
  });
  return result;
}

// ============================================================================
// Helpers — carregamento
// ============================================================================

async function loadEnabledFollowups(db: AgentDb): Promise<AgentFollowup[]> {
  // Cross-org: service_role bypassa RLS. Listamos TODOS pra um unico tick
  // cobrir multi-tenant. order_index nao importa aqui (cada followup tem
  // seu proprio gatilho independente).
  const { data, error } = await db
    .from("agent_followups")
    .select("*")
    .eq("is_enabled", true);
  if (error) {
    logError("ai_agent_followups_tick_load_failed", {
      organization_id: null,
      error: error.message,
    });
    return [];
  }
  return (data ?? []) as AgentFollowup[];
}

async function loadTemplateForFollowup(
  db: AgentDb,
  followup: AgentFollowup,
): Promise<AgentNotificationTemplate | null> {
  const { data, error } = await db
    .from("agent_notification_templates")
    .select("*")
    .eq("organization_id", followup.organization_id)
    .eq("id", followup.template_id)
    .maybeSingle();
  if (error) {
    logError("ai_agent_followups_template_load_failed", {
      organization_id: followup.organization_id,
      followup_id: followup.id,
      template_id: followup.template_id,
      error: error.message,
    });
    return null;
  }
  return (data as AgentNotificationTemplate | null) ?? null;
}

async function getOrLoadConfig(
  db: AgentDb,
  orgId: string,
  configId: string,
  cache: Map<string, { name: string; status: string } | null>,
): Promise<{ name: string; status: string } | null> {
  if (cache.has(configId)) return cache.get(configId) ?? null;
  const { data } = await db
    .from("agent_configs")
    .select("name, status")
    .eq("organization_id", orgId)
    .eq("id", configId)
    .maybeSingle();
  const value = (data as { name: string; status: string } | null) ?? null;
  cache.set(configId, value);
  return value;
}

async function getOrLoadProvider(
  db: AgentDb,
  orgId: string,
  cache: Map<string, WhatsAppProvider | null>,
): Promise<WhatsAppProvider | null> {
  if (cache.has(orgId)) return cache.get(orgId) ?? null;
  const { data, error } = await db
    .from("whatsapp_connections")
    .select(
      "provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token",
    )
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .maybeSingle();
  if (error || !data) {
    cache.set(orgId, null);
    return null;
  }
  try {
    const provider = createProvider(data as Record<string, unknown>);
    cache.set(orgId, provider);
    return provider;
  } catch (err: unknown) {
    logError("ai_agent_followups_provider_factory_failed", {
      organization_id: orgId,
      error: errorMessage(err),
    });
    cache.set(orgId, null);
    return null;
  }
}

// ============================================================================
// Helpers — query de conversations elegiveis + disparo individual
// ============================================================================

interface DueConversation {
  id: string;
  organization_id: string;
  lead_id: string;
  crm_conversation_id: string | null;
  last_interaction_at: string | null;
}

interface DueConversationsResult {
  /** Conversas que estouraram o threshold + estao fora de handoff (PRE-dedupe). */
  matchedCount: number;
  /** Subset prontas pra dispatch (POS-dedupe contra agent_followup_runs). */
  pending: DueConversation[];
}

async function loadDueConversations(
  db: AgentDb,
  followup: AgentFollowup,
): Promise<DueConversationsResult> {
  const threshold = new Date(Date.now() - followup.delay_hours * 60 * 60 * 1000).toISOString();

  // Step 1: conversations que estouraram o threshold + nao estao em handoff
  const { data: convs, error } = await db
    .from("agent_conversations")
    .select("id, organization_id, lead_id, crm_conversation_id, last_interaction_at, human_handoff_at")
    .eq("organization_id", followup.organization_id)
    .eq("config_id", followup.config_id)
    .is("human_handoff_at", null)
    .lt("last_interaction_at", threshold)
    .order("last_interaction_at", { ascending: true })
    .limit(MAX_PROCESSED_PER_TICK);
  if (error) {
    logError("ai_agent_followups_due_load_failed", {
      organization_id: followup.organization_id,
      followup_id: followup.id,
      error: error.message,
    });
    return { matchedCount: 0, pending: [] };
  }
  const candidates = (convs ?? []) as Array<DueConversation & { human_handoff_at: string | null }>;
  if (candidates.length === 0) return { matchedCount: 0, pending: [] };

  // Step 2: filtra conversas que ja foram disparadas pra este followup.
  // Idealmente seria um LEFT JOIN... IS NULL, mas Supabase JS client nao
  // suporta join direto cross-table. Buscamos os runs ja registrados e
  // filtramos em memoria. Lista limitada por MAX_PROCESSED_PER_TICK
  // (200), entao .in(...) e tranquilo.
  const ids = candidates.map((c) => c.id);
  const { data: runs } = await db
    .from("agent_followup_runs")
    .select("conversation_id")
    .eq("followup_id", followup.id)
    .in("conversation_id", ids);
  const firedSet = new Set(
    ((runs ?? []) as Array<{ conversation_id: string }>).map((r) => r.conversation_id),
  );

  const pending = candidates
    .filter((c) => !firedSet.has(c.id))
    .map((c) => ({
      id: c.id,
      organization_id: c.organization_id,
      lead_id: c.lead_id,
      crm_conversation_id: c.crm_conversation_id,
      last_interaction_at: c.last_interaction_at,
    }));

  return { matchedCount: candidates.length, pending };
}

interface DispatchParams {
  db: AgentDb;
  followup: AgentFollowup;
  template: AgentNotificationTemplate;
  agentName: string;
  conversation: DueConversation;
  provider: WhatsAppProvider;
}

interface DispatchOutcome {
  /** True se o INSERT em agent_followup_runs + sendText completaram. */
  fired: boolean;
  /** Texto curto do erro quando algo falhou apos o INSERT (pra error_samples). */
  error?: string;
}

async function dispatchFollowup(params: DispatchParams): Promise<DispatchOutcome> {
  const { db, followup, template, agentName, conversation, provider } = params;

  // 1. Carrega lead.name + phone PRIMEIRO. Se nao tem phone, abortamos
  // ANTES do INSERT — assim nao queimamos a oportunidade de disparar
  // se o cliente adicionar o phone depois.
  const { data: leadRow, error: leadError } = await db
    .from("leads")
    .select("name, phone")
    .eq("organization_id", conversation.organization_id)
    .eq("id", conversation.lead_id)
    .maybeSingle();
  if (leadError) {
    return { fired: false, error: `lead lookup failed: ${leadError.message}` };
  }
  const lead = (leadRow as { name?: string | null; phone?: string | null } | null) ?? null;
  if (!lead || !lead.phone) {
    // Sem phone — skip silencioso (volta a tentar quando phone for setado).
    return { fired: false };
  }

  // 2. Idempotency lock: INSERT antes de qualquer side effect. UNIQUE
  // (followup_id, conversation_id) — se 2 ticks rodam simultaneo, um
  // ganha (insert ok), outro cai em 23505 e skipa silencioso.
  const { error: runInsertError } = await db.from("agent_followup_runs").insert({
    organization_id: conversation.organization_id,
    followup_id: followup.id,
    conversation_id: conversation.id,
  });
  if (runInsertError) {
    const code = (runInsertError as { code?: string }).code;
    // 23505 = unique_violation. Significa que outro tick (ou esse mesmo
    // numa retry concorrente) ja disparou — comportamento esperado, skip.
    if (code === "23505") {
      return { fired: false };
    }
    return { fired: false, error: `run insert failed: ${runInsertError.message}` };
  }

  // 3. Render body. Followups enviam pro LEAD (nao pra equipe), entao
  // wa_link aponta pra conversation do CRM e lead_phone na fixed vars
  // e o numero DO LEAD (nao o destino da mensagem — paridade com o
  // trigger_notification handler).
  const fixed: NotificationFixedVariables = {
    lead_name: lead.name?.trim() || "cliente",
    lead_phone: lead.phone.replace(/\D/g, ""),
    wa_link: conversation.crm_conversation_id
      ? buildNotificationWaLink(conversation.crm_conversation_id)
      : `${process.env.PERSIA_APP_URL ?? DEFAULT_APP_URL}/chat`,
    agent_name: agentName,
  };

  let renderedBody: string;
  try {
    renderedBody = renderNotificationTemplate(template.body_template, fixed, undefined);
  } catch (err: unknown) {
    return { fired: false, error: `render failed: ${errorMessage(err)}` };
  }

  // 4. Envia pra LEAD. Se sendText falhar, a row em agent_followup_runs
  // FICA (nao rollbackamos) — preferimos NAO re-tentar disparo
  // automaticamente, pra evitar spam quando provider esta flaky. Cliente
  // que reportar pode revisitar o run manualmente.
  try {
    await provider.sendText({
      phone: fixed.lead_phone,
      message: renderedBody,
    });
    return { fired: true };
  } catch (err: unknown) {
    const message = errorMessage(err);
    logError("ai_agent_followups_send_failed", {
      organization_id: conversation.organization_id,
      followup_id: followup.id,
      conversation_id: conversation.id,
      lead_id: conversation.lead_id,
      error: message,
    });
    return { fired: false, error: `send failed: ${message}` };
  }
}
