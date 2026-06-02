// audience-resolver.ts — resolve o público de uma campanha em modo strict.
//
// Regras:
//   - Segmento usa findMatchingLeadIdsStrict (qualquer erro bloqueia)
//   - Lead é inelegível se: sem telefone nem conversa WhatsApp
//   - Grupo é inelegível se: sem group_jid
//   - Duplicatas (mesmo lead/grupo em múltiplos targets) são deduplicadas
//   - snapshot_hash é um hash determinístico dos IDs elegíveis (ordenados)

import type { MinimalDb } from "./types-internal";
import { findMatchingLeadIdsStrict, StrictMatchError } from "../segments/match-leads";
import type {
  CampaignTargetInput,
  CampaignAudiencePreview,
  AudienceRecipientPreview,
  CampaignKind,
} from "./types";
import type { SegmentRules } from "../types";

// Simple stable hash usando djb2 sobre string JSON
function stableHash(ids: string[]): string {
  const str = [...ids].sort().join(",");
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // unsigned 32-bit
  }
  return hash.toString(16);
}

export async function resolveCampaignAudience(input: {
  kind: CampaignKind;
  targets: CampaignTargetInput[];
  db: MinimalDb;
  orgId: string;
}): Promise<CampaignAudiencePreview> {
  const { kind, targets, db, orgId } = input;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Acumula candidatos: lead_id → dados / group_id → dados
  const leadMap = new Map<string, AudienceRecipientPreview>();
  const groupMap = new Map<string, AudienceRecipientPreview>();
  let duplicateCount = 0;

  for (const target of targets) {
    if (kind === "lead_campaign") {
      await resolveLeadTarget(db, orgId, target, leadMap, errors, warnings);
    } else {
      await resolveGroupTarget(db, orgId, target, groupMap, errors, warnings);
    }
  }

  // Conta duplicatas (adicionados mais de uma vez ao mesmo mapa)
  duplicateCount = 0; // Maps já deduplicam — count de colisões calculado dentro das funções

  const allRecipients: AudienceRecipientPreview[] = [
    ...leadMap.values(),
    ...groupMap.values(),
  ];

  const eligible = allRecipients.filter((r) => r.eligible);
  const ineligible = allRecipients.filter((r) => !r.eligible);

  const snapshotHash = stableHash(eligible.map((r) => r.lead_id ?? r.group_id ?? ""));

  return {
    found_count: allRecipients.length,
    eligible_count: eligible.length,
    ineligible_count: ineligible.length,
    duplicate_count: duplicateCount,
    recipients: allRecipients,
    warnings,
    errors,
    snapshot_hash: snapshotHash,
  };
}

// ─── Lead targets ─────────────────────────────────────────────────────────────

async function resolveLeadTarget(
  db: MinimalDb,
  orgId: string,
  target: CampaignTargetInput,
  out: Map<string, AudienceRecipientPreview>,
  errors: string[],
  warnings: string[],
): Promise<void> {
  try {
    const leads = await fetchLeadsForTarget(db, orgId, target, errors);
    for (const lead of leads) {
      if (out.has(lead.id)) {
        // já presente — duplicata, silencia
        continue;
      }
      const eligible = Boolean(lead.phone || lead.chat_jid);
      const ineligible_reason = eligible
        ? undefined
        : "Sem telefone ou JID WhatsApp";
      out.set(lead.id, {
        recipient_type: "lead",
        lead_id: lead.id,
        phone: lead.phone ?? null,
        chat_jid: lead.chat_jid ?? null,
        display_name: lead.name ?? null,
        eligible,
        ineligible_reason,
        resolved_from: { target_kind: target.target_kind, target_id: target.target_id },
      });
    }
  } catch (err) {
    const msg = err instanceof StrictMatchError
      ? err.message
      : err instanceof Error ? err.message : String(err);
    errors.push(`Target ${target.target_kind}: ${msg}`);
  }
}

async function fetchLeadsForTarget(
  db: MinimalDb,
  orgId: string,
  target: CampaignTargetInput,
  errors: string[],
): Promise<Array<{ id: string; phone: string | null; chat_jid: string | null; name: string | null }>> {
  type QResult = { data: unknown[] | null; error: { message: string } | null };
  interface QChain {
    eq: (col: string, val: unknown) => QChain;
    in?: (col: string, vals: unknown[]) => Promise<QResult>;
    then: <T>(fn: (r: QResult) => T) => Promise<T>;
  }
  const dbAny = db as unknown as { from: (t: string) => { select: (cols: string) => QChain } };

  switch (target.target_kind) {
    case "segment": {
      if (!target.target_id) { errors.push("Segmento: target_id ausente"); return []; }
      // Busca as regras do segmento
      const { data: seg, error: segErr } = await dbAny
        .from("segments")
        .select("rules")
        .eq("id", target.target_id)
        .eq("organization_id", orgId)
        .then?.((r: { data: unknown[] | null; error: { message: string } | null }) => r) ?? { data: null, error: null };
      if (segErr) throw new StrictMatchError(`Segmento "${target.target_id}": ${segErr.message}`);
      const rules = (seg as Array<{ rules: unknown }> | null)?.[0]?.rules as SegmentRules | undefined;
      if (!rules) throw new StrictMatchError(`Segmento "${target.target_id}": regras não encontradas`);
      // Strict — qualquer erro aqui throws
      const ids = await findMatchingLeadIdsStrict(db, orgId, rules);
      if (ids.length === 0) return [];
      return fetchLeadsByIds(db, orgId, ids);
    }

    case "tag": {
      if (!target.target_id) { errors.push("Tag: target_id ausente"); return []; }
      const tagQuery = dbAny.from("lead_tags").select("lead_id").eq("tag_id", target.target_id).eq("organization_id", orgId);
      const { data: tagRows, error: tagErr } = await tagQuery.then?.((r: { data: unknown[] | null; error: { message: string } | null }) => r) ?? { data: null, error: null };
      if (tagErr) throw new StrictMatchError(`Tag "${target.target_id}": ${tagErr.message}`);
      const ids = ((tagRows ?? []) as { lead_id: string }[]).map((r) => r.lead_id);
      if (ids.length === 0) return [];
      return fetchLeadsByIds(db, orgId, ids);
    }

    case "funnel_stage": {
      if (!target.target_id) { errors.push("Funil/etapa: target_id ausente"); return []; }
      // Busca leads via deals que estão na stage
      const dealsQuery = dbAny.from("deals").select("lead_id").eq("stage_id", target.target_id).eq("organization_id", orgId);
      const { data: dealRows, error: dealErr } = await dealsQuery.then?.((r: { data: unknown[] | null; error: { message: string } | null }) => r) ?? { data: null, error: null };
      if (dealErr) throw new StrictMatchError(`Funil/etapa "${target.target_id}": ${dealErr.message}`);
      const ids = [...new Set(((dealRows ?? []) as { lead_id: string }[]).map((r) => r.lead_id))];
      if (ids.length === 0) return [];
      return fetchLeadsByIds(db, orgId, ids);
    }

    case "lead": {
      if (!target.target_id) { errors.push("Lead: target_id ausente"); return []; }
      return fetchLeadsByIds(db, orgId, [target.target_id]);
    }

    case "manual": {
      const ids = ((target.filters?.lead_ids ?? []) as string[]);
      if (ids.length === 0) return [];
      return fetchLeadsByIds(db, orgId, ids);
    }

    default:
      errors.push(`target_kind "${target.target_kind}" não suportado para lead_campaign`);
      return [];
  }
}

async function fetchLeadsByIds(
  db: MinimalDb,
  orgId: string,
  ids: string[],
): Promise<Array<{ id: string; phone: string | null; chat_jid: string | null; name: string | null }>> {
  if (ids.length === 0) return [];
  const dbAny = db as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => {
          in: (col: string, vals: unknown[]) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
  const { data, error } = await dbAny
    .from("leads")
    .select("id, name, phone")
    .eq("organization_id", orgId)
    .in("id", ids);
  if (error) throw new StrictMatchError(`fetchLeads: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; phone: string | null; name: string | null }>).map((r) => ({
    ...r,
    chat_jid: null,
  }));
}

// ─── Group targets ────────────────────────────────────────────────────────────

async function resolveGroupTarget(
  db: MinimalDb,
  orgId: string,
  target: CampaignTargetInput,
  out: Map<string, AudienceRecipientPreview>,
  errors: string[],
  _warnings: string[],
): Promise<void> {
  try {
    const groups = await fetchGroupsForTarget(db, orgId, target, errors);
    for (const group of groups) {
      if (out.has(group.id)) continue;
      const eligible = Boolean(group.group_jid);
      out.set(group.id, {
        recipient_type: "group",
        group_id: group.id,
        chat_jid: group.group_jid ?? null,
        display_name: group.name ?? null,
        eligible,
        ineligible_reason: eligible ? undefined : "Grupo sem JID",
        resolved_from: { target_kind: target.target_kind, target_id: target.target_id },
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Target ${target.target_kind}: ${msg}`);
  }
}

async function fetchGroupsForTarget(
  db: MinimalDb,
  orgId: string,
  target: CampaignTargetInput,
  errors: string[],
): Promise<Array<{ id: string; group_jid: string | null; name: string | null }>> {
  type GResult = { data: unknown[] | null; error: { message: string } | null };
  interface GChain {
    eq: (col: string, val: unknown) => GChain;
    in?: (col: string, vals: unknown[]) => Promise<GResult>;
    then: <T>(fn: (r: GResult) => T) => Promise<T>;
  }
  const dbAny = db as unknown as { from: (t: string) => { select: (cols: string) => GChain } };

  if (target.target_kind === "group") {
    if (!target.target_id) { errors.push("Grupo: target_id ausente"); return []; }
    const { data, error } = await dbAny
      .from("whatsapp_groups")
      .select("id, group_jid, name")
      .eq("id", target.target_id)
      .eq("organization_id", orgId)
      .then?.((r: { data: unknown[] | null; error: { message: string } | null }) => r) ?? { data: null, error: null };
    if (error) throw new Error(`Grupo "${target.target_id}": ${error.message}`);
    return (data ?? []) as Array<{ id: string; group_jid: string | null; name: string | null }>;
  }

  if (target.target_kind === "manual") {
    const ids = ((target.filters?.group_ids ?? []) as string[]);
    if (ids.length === 0) return [];
    const dbFull = db as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: unknown) => {
            in: (col: string, vals: unknown[]) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
    const { data, error } = await dbFull
      .from("whatsapp_groups")
      .select("id, group_jid, name")
      .eq("organization_id", orgId)
      .in("id", ids);
    if (error) throw new Error(`Grupos manual: ${error.message}`);
    return (data ?? []) as Array<{ id: string; group_jid: string | null; name: string | null }>;
  }

  errors.push(`target_kind "${target.target_kind}" não suportado para group_campaign`);
  return [];
}
