// AI Agent — handler `round_robin_user`.
//
// PR-FLOW-PIVOT PR 13 (mai/2026): action node "Distribuir lead
// (rodízio)" — destrava o item (5) do flow.json do Jordan Moura
// (Humana Saúde): queue/round-robin de leads.
//
// Algoritmo V1: least-loaded
//   1. Carrega membros ativos da org com role atribuível (agent,
//      admin, owner — viewer NÃO recebe leads)
//   2. Pra cada membro, conta leads ativos (status NOT IN ('won',
//      'lost', 'archived'))
//   3. Escolhe quem tem MENOS. Tiebreaker: user_id ASC (determinismo)
//   4. UPDATE leads.assigned_to = chosen.user_id
//   5. Pausa agent (mesmo do transfer_to_user — humano assumiu)
//   6. Log activity
//
// Por que least-loaded em vez de rotação verdadeira (state-tracking):
// - Auto-balanceia se 1 atendente está OOO (leads param de vir pra ele
//   porque tem muitos abertos, e ele vai naturalmente perder priorida-
//   de até esvaziar)
// - Não precisa state em DB (sem migration nova)
// - Determinístico (tiebreaker estável)
//
// V1 NÃO faz:
//   - Filtro por role/department (todos os membros atribuíveis são
//     elegíveis). V2 pode adicionar config opcional
//   - Skip de membros em OOO/férias (sem coluna em organization_members)
//   - "Verdadeira rotação" round-robin (state-tracking de last_assigned).
//     V2 se feedback indicar que least-loaded gera distribuição enviesada

import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import { pauseAgent } from "../pause-agent";
import { errorMessage, logError } from "@/lib/observability";
import {
  failureResult,
  getHandlerDb,
  insertLeadActivity,
  successResult,
  trimReason,
} from "./shared";

// Status que removem o lead do "pile" do atendente — não contam pro
// load. Mantém alinhado com convenção do CRM (won/lost finais; archived
// pra leads spam/inválidos).
const TERMINAL_STATUSES = ["won", "lost", "archived"] as const;

// Roles elegíveis pra receber leads. Viewer fica fora — só lê dados.
const ASSIGNABLE_ROLES = ["agent", "admin", "owner"] as const;

const roundRobinUserSchema = z.object({
  reason: z.string().trim().min(1).max(500).nullish(),
});

interface MemberCandidate {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  load: number;
}

export const roundRobinUserHandler: NativeHandler = async (context, input) => {
  const parsed = roundRobinUserSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid round_robin_user input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  if (!context.lead_id) {
    return failureResult("no lead_id in context");
  }

  const reason = trimReason(parsed.data.reason, "round_robin_distribution");

  // 1. Carrega membros ativos com role atribuível.
  const { data: members, error: memberError } = await db
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", context.organization_id)
    .eq("is_active", true)
    .in("role", ASSIGNABLE_ROLES as unknown as string[]);
  if (memberError) return failureResult(memberError.message);

  const eligibleMembers = ((members ?? []) as Array<{
    user_id?: string | null;
    role?: string | null;
  }>)
    .filter(
      (m): m is { user_id: string; role: string } =>
        typeof m.user_id === "string" &&
        typeof m.role === "string" &&
        (ASSIGNABLE_ROLES as readonly string[]).includes(m.role),
    );

  if (eligibleMembers.length === 0) {
    return failureResult("nenhum atendente elegível na organização", {
      hint: "verifique organization_members com role agent/admin/owner ativos",
    });
  }

  // 2. Pra cada membro, conta leads ativos. V1 faz N queries em paralelo
  //    (orgs típicas: ≤20 membros). V2 pode virar 1 query com GROUP BY
  //    se virar gargalo.
  const loadCounts = await Promise.all(
    eligibleMembers.map(async (m) => {
      const { count, error } = await db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", context.organization_id)
        .eq("assigned_to", m.user_id)
        .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`);
      if (error) {
        // Falha em 1 membro = trata como infinito (skip dele do tiebreaker).
        // Outras candidaturas ainda funcionam.
        logError("round_robin_user_count_failed", {
          organization_id: context.organization_id,
          user_id: m.user_id,
          error: error.message,
        });
        return { user_id: m.user_id, role: m.role, load: Number.POSITIVE_INFINITY };
      }
      return { user_id: m.user_id, role: m.role, load: count ?? 0 };
    }),
  );

  // 3. Carrega profiles dos candidatos pra display name.
  const candidateIds = loadCounts.map((c) => c.user_id);
  const { data: profiles, error: profileError } = await db
    .from("profiles")
    .select("id, full_name, email")
    .in("id", candidateIds);
  if (profileError) return failureResult(profileError.message);

  const profileMap = new Map<string, { full_name: string | null; email: string | null }>(
    ((profiles ?? []) as Array<{
      id: string;
      full_name?: string | null;
      email?: string | null;
    }>).map((p) => [p.id, { full_name: p.full_name ?? null, email: p.email ?? null }]),
  );

  // 4. Sort por (load ASC, user_id ASC) — determinismo no tiebreaker.
  const candidates: MemberCandidate[] = loadCounts
    .map((c) => {
      const profile = profileMap.get(c.user_id) ?? { full_name: null, email: null };
      return {
        user_id: c.user_id,
        full_name: profile.full_name,
        email: profile.email,
        role: c.role,
        load: c.load,
      };
    })
    .sort((a, b) => {
      if (a.load !== b.load) return a.load - b.load;
      return a.user_id < b.user_id ? -1 : 1;
    });

  const chosen = candidates[0];
  if (!chosen || !Number.isFinite(chosen.load)) {
    return failureResult("falha ao calcular carga dos atendentes — tente novamente");
  }

  const displayName =
    chosen.full_name?.trim() ||
    chosen.email?.trim() ||
    `user:${chosen.user_id.slice(0, 8)}`;

  // Dry-run (Tester): simula sem tocar DB. Mostra escolha + load.
  if (context.dry_run) {
    return successResult(
      {
        user_id: chosen.user_id,
        assigned_to: chosen.user_id,
        assignee_name: displayName,
        load: chosen.load,
        candidates: candidates.length,
        reason,
      },
      [
        `would assign lead to ${displayName} (load=${chosen.load}, ${candidates.length} candidatos)`,
      ],
    );
  }

  // 5. UPDATE leads.assigned_to.
  const { error: leadError } = await db
    .from("leads")
    .update({
      assigned_to: chosen.user_id,
      updated_at: nowIso(),
    })
    .eq("id", context.lead_id)
    .eq("organization_id", context.organization_id);

  if (leadError) return failureResult(leadError.message);

  // 6. Pausa agente — humano assumiu (paridade com transfer_to_user).
  const pauseResult = await pauseAgent({
    db,
    orgId: context.organization_id,
    agentConversationId: context.agent_conversation_id,
    reason: `round_robin_distribution:${displayName}`,
  });
  if (pauseResult.error) {
    logError("round_robin_user_pause_failed", {
      organization_id: context.organization_id,
      agent_conversation_id: context.agent_conversation_id,
      assigned_to: chosen.user_id,
      error: pauseResult.error,
    });
  }

  // 7. Activity log no histórico do lead.
  try {
    await insertLeadActivity({
      db,
      organizationId: context.organization_id,
      leadId: context.lead_id,
      type: "assigned",
      description: `Distribuição automática: lead atribuído a ${displayName} (load=${chosen.load}). Motivo: ${reason}`,
      metadata: {
        conversation_id: context.crm_conversation_id,
        agent_conversation_id: context.agent_conversation_id,
        assigned_to: chosen.user_id,
        run_id: context.run_id,
        agent_paused: pauseResult.paused,
        algorithm: "least_loaded",
        load: chosen.load,
        candidates_count: candidates.length,
      },
    });
  } catch (err) {
    // Best-effort — lead já foi reatribuído, não desfazer por falha
    // de activity log.
    logError("round_robin_user_activity_failed", {
      organization_id: context.organization_id,
      lead_id: context.lead_id,
      error: errorMessage(err),
    });
  }

  const notes = [
    `assigned lead to ${displayName} (least-loaded among ${candidates.length})`,
  ];
  if (pauseResult.paused) {
    notes.push("paused native agent for this conversation");
  }

  return successResult(
    {
      user_id: chosen.user_id,
      assigned_to: chosen.user_id,
      assignee_name: displayName,
      load: chosen.load,
      candidates: candidates.length,
      algorithm: "least_loaded",
      reason,
      agent_paused: pauseResult.paused,
    },
    notes,
  );
};
