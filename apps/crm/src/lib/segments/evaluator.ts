// Segments — evaluator de membership pra disparar agent_flows.
//
// PR-FLOW-PIVOT PR 12 (mai/2026): segments hoje são rule-based, sem
// tabela de membership. Migration 058 cria `segment_memberships` pra
// persistir o estado. Este evaluator é chamado APÓS mutações de lead
// (createLead, updateLead, addTag, removeTag, set_lead_custom_field):
//
//   1. Carrega todos os segments da org com rules cadastradas
//   2. Pra cada segment, chama findMatchingLeadIds + checa se leadId
//      está incluído. Single-lead check via includes (V1; V2 pode
//      otimizar com versão LIMIT 1 WHERE id=leadId)
//   3. Carrega memberships atuais do lead
//   4. INSERTs apenas onde lead matches AND não tem membership
//   5. Retorna IDs dos segments recém-adicionados pra caller disparar
//      triggerAgentFlowsForSegmentEntry
//
// V1 NÃO trata "saída" (lead que parou de casar não remove membership
// — quando voltar a casar, dispara o flow de novo). PR posterior pode
// adicionar `left_at` se houver caso de uso.

import { findMatchingLeadIds } from "@persia/shared/crm";
import type { SegmentRules } from "@persia/shared/crm";
import { errorMessage, logError } from "@/lib/observability";
import { asAgentDb, type AgentDb } from "@/lib/ai-agent/db";

interface SegmentRow {
  id: string;
  rules: unknown;
}

interface MembershipRow {
  segment_id: string;
}

/**
 * Avalia todos os segments da org pra `leadId`, persiste novas
 * memberships, retorna IDs dos segments recém-adicionados.
 *
 * Defensive: erros individuais por segment não derrubam o batch.
 * Falhas logam em observability + segue.
 */
export async function evaluateLeadSegmentMembership(
  supabaseOrAgentDb: AgentDb | { from: (table: string) => unknown },
  orgId: string,
  leadId: string,
): Promise<string[]> {
  const db = asAgentDb(supabaseOrAgentDb as AgentDb);

  let segments: SegmentRow[] = [];
  try {
    const { data, error } = await db
      .from("segments")
      .select("id, rules")
      .eq("organization_id", orgId);
    if (error) {
      logError("segment_evaluator_load_segments_failed", {
        organization_id: orgId,
        lead_id: leadId,
        error: error.message,
      });
      return [];
    }
    segments = (data ?? []) as SegmentRow[];
  } catch (err) {
    logError("segment_evaluator_load_segments_threw", {
      organization_id: orgId,
      lead_id: leadId,
      error: errorMessage(err),
    });
    return [];
  }

  if (segments.length === 0) return [];

  // Carrega memberships atuais do lead pra detectar quais são novos.
  // Hotfix-friendly: se tabela não existir (migration 058 não rodou),
  // retorna []  — não bloqueia mutações de lead.
  let existingMemberships = new Set<string>();
  try {
    const { data, error } = await db
      .from("segment_memberships")
      .select("segment_id")
      .eq("organization_id", orgId)
      .eq("lead_id", leadId);
    if (error) {
      const msg = error.message ?? "";
      if (
        /relation .*segment_memberships.* does not exist/i.test(msg) ||
        /could not find the table/i.test(msg) ||
        msg.includes("PGRST205")
      ) {
        // Migration pending — silencia + log warn (caller continua sem
        // disparar).
        console.warn(
          "[segment-evaluator] segment_memberships table missing — migration 058 pending?",
        );
        return [];
      }
      logError("segment_evaluator_load_memberships_failed", {
        organization_id: orgId,
        lead_id: leadId,
        error: msg,
      });
      return [];
    }
    existingMemberships = new Set(
      ((data ?? []) as MembershipRow[]).map((m) => m.segment_id),
    );
  } catch (err) {
    logError("segment_evaluator_load_memberships_threw", {
      organization_id: orgId,
      lead_id: leadId,
      error: errorMessage(err),
    });
    return [];
  }

  // Pra cada segment: avalia, e se casa MAS ainda não tem membership,
  // insere + adiciona ao output.
  const newlyAdded: string[] = [];
  for (const segment of segments) {
    if (existingMemberships.has(segment.id)) continue; // já membro, skip

    let matchedIds: string[] | null;
    try {
      // findMatchingLeadIds aceita `MinimalDb` compatible — AgentDb basta.
      matchedIds = await findMatchingLeadIds(
        db as Parameters<typeof findMatchingLeadIds>[0],
        orgId,
        segment.rules as SegmentRules | null | undefined,
      );
    } catch (err) {
      logError("segment_evaluator_match_failed", {
        organization_id: orgId,
        lead_id: leadId,
        segment_id: segment.id,
        error: errorMessage(err),
      });
      continue;
    }
    // null = rules vazias/inválidas → não conta como match
    if (matchedIds === null) continue;
    if (!matchedIds.includes(leadId)) continue;

    // INSERT idempotente. PK (segment_id, lead_id) garante 1 row.
    try {
      const { error } = await db.from("segment_memberships").insert({
        segment_id: segment.id,
        lead_id: leadId,
        organization_id: orgId,
      });
      if (error) {
        // Conflito é OK (race condition entre 2 evaluators paralelos).
        const msg = error.message ?? "";
        const isDuplicate =
          /duplicate key/i.test(msg) || /23505/.test(msg) || /unique/i.test(msg);
        if (!isDuplicate) {
          logError("segment_evaluator_insert_failed", {
            organization_id: orgId,
            lead_id: leadId,
            segment_id: segment.id,
            error: msg,
          });
        }
        continue;
      }
      newlyAdded.push(segment.id);
    } catch (err) {
      logError("segment_evaluator_insert_threw", {
        organization_id: orgId,
        lead_id: leadId,
        segment_id: segment.id,
        error: errorMessage(err),
      });
    }
  }

  return newlyAdded;
}
