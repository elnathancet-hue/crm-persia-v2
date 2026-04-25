import "server-only";

import type { LeadFilter } from "@persia/shared/ai-agent";
import {
  SCHEDULED_JOB_LEADS_PER_TICK_MAX,
} from "@persia/shared/ai-agent";
import type { AgentDb } from "../db";

interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  status: string | null;
  created_at: string;
}

interface ConversationRow {
  id: string;
  lead_id: string;
  status: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface ResolvedScheduledLead {
  id: string;
  name: string | null;
  phone: string | null;
  crmConversationId: string | null;
}

export interface ResolveScheduledJobLeadsResult {
  leads: ResolvedScheduledLead[];
  matchedCount: number;
  skippedCount: number;
}

export async function resolveScheduledJobLeads(params: {
  db: AgentDb;
  organizationId: string;
  configId: string;
  filter: LeadFilter;
  now?: Date;
  limit?: number;
}): Promise<ResolveScheduledJobLeadsResult> {
  const limit = Math.max(
    1,
    Math.min(
      params.limit ?? SCHEDULED_JOB_LEADS_PER_TICK_MAX,
      SCHEDULED_JOB_LEADS_PER_TICK_MAX,
    ),
  );
  const now = params.now ?? new Date();

  let leads = await loadBaseLeads(params.db, params.organizationId, params.filter);
  if (leads.length === 0) {
    return { leads: [], matchedCount: 0, skippedCount: 0 };
  }

  leads = filterByAge(leads, params.filter, now);
  if (leads.length === 0) {
    return { leads: [], matchedCount: 0, skippedCount: 0 };
  }

  leads = await filterByTags(params.db, params.organizationId, leads, params.filter);
  leads = await filterByPipelineStages(
    params.db,
    params.organizationId,
    leads,
    params.filter,
  );
  leads = await filterByActiveAgents(
    params.db,
    params.organizationId,
    params.configId,
    leads,
    params.filter,
  );
  leads = await filterByRecentSilence(
    params.db,
    params.organizationId,
    leads,
    params.filter,
    now,
  );

  if (leads.length === 0) {
    return { leads: [], matchedCount: 0, skippedCount: 0 };
  }

  const conversationMap = await loadConversationMap(
    params.db,
    params.organizationId,
    leads.map((lead) => lead.id),
  );

  const matchedCount = leads.length;
  return {
    leads: leads.slice(0, limit).map((lead) => ({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      crmConversationId: conversationMap.get(lead.id) ?? null,
    })),
    matchedCount,
    skippedCount: Math.max(0, matchedCount - limit),
  };
}

async function loadBaseLeads(
  db: AgentDb,
  organizationId: string,
  filter: LeadFilter,
): Promise<LeadRow[]> {
  let query = db
    .from("leads")
    .select("id, name, phone, status, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (filter.statuses?.length) {
    query = query.in("status", filter.statuses);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadRow[];
}

function filterByAge(
  leads: LeadRow[],
  filter: LeadFilter,
  now: Date,
): LeadRow[] {
  if (!filter.age_days) return leads;

  const cutoff = now.getTime() - filter.age_days.days * 24 * 60 * 60 * 1000;
  return leads.filter((lead) => {
    const createdAt = Date.parse(lead.created_at);
    if (Number.isNaN(createdAt)) return false;

    switch (filter.age_days?.comparison) {
      case "gt":
        return createdAt < cutoff;
      case "gte":
        return createdAt <= cutoff;
      case "lt":
        return createdAt > cutoff;
      case "lte":
        return createdAt >= cutoff;
      default:
        return true;
    }
  });
}

async function filterByTags(
  db: AgentDb,
  organizationId: string,
  leads: LeadRow[],
  filter: LeadFilter,
): Promise<LeadRow[]> {
  if (!filter.tag_slugs?.length || leads.length === 0) return leads;

  const desiredTags = new Set(
    filter.tag_slugs.map((value) => normalizeTagName(value)),
  );
  const { data, error } = await db
    .from("lead_tags")
    .select("lead_id, tags(name)")
    .eq("organization_id", organizationId)
    .in(
      "lead_id",
      leads.map((lead) => lead.id),
    );

  if (error) throw new Error(error.message);

  const matchingLeadIds = new Set<string>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const tagName = extractTagName(row);
    if (!tagName || !desiredTags.has(normalizeTagName(tagName))) continue;
    matchingLeadIds.add(String(row.lead_id));
  }

  return leads.filter((lead) => matchingLeadIds.has(lead.id));
}

async function filterByPipelineStages(
  db: AgentDb,
  organizationId: string,
  leads: LeadRow[],
  filter: LeadFilter,
): Promise<LeadRow[]> {
  if (!filter.pipeline_stage_ids?.length || leads.length === 0) return leads;

  const { data, error } = await db
    .from("deals")
    .select("lead_id, stage_id")
    .eq("organization_id", organizationId)
    .in(
      "lead_id",
      leads.map((lead) => lead.id),
    )
    .in("stage_id", filter.pipeline_stage_ids);

  if (error) throw new Error(error.message);

  const matchingLeadIds = new Set(
    ((data ?? []) as Array<{ lead_id: string | null }>)
      .map((row) => row.lead_id)
      .filter((value): value is string => typeof value === "string"),
  );

  return leads.filter((lead) => matchingLeadIds.has(lead.id));
}

async function filterByActiveAgents(
  db: AgentDb,
  organizationId: string,
  configId: string,
  leads: LeadRow[],
  filter: LeadFilter,
): Promise<LeadRow[]> {
  if (!filter.only_active_agents || leads.length === 0) return leads;

  const { data, error } = await db
    .from("agent_conversations")
    .select("lead_id, human_handoff_at")
    .eq("organization_id", organizationId)
    .eq("config_id", configId)
    .in(
      "lead_id",
      leads.map((lead) => lead.id),
    );

  if (error) throw new Error(error.message);

  const activeLeadIds = new Set<string>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (row.human_handoff_at == null && typeof row.lead_id === "string") {
      activeLeadIds.add(row.lead_id);
    }
  }

  return leads.filter((lead) => activeLeadIds.has(lead.id));
}

async function filterByRecentSilence(
  db: AgentDb,
  organizationId: string,
  leads: LeadRow[],
  filter: LeadFilter,
  now: Date,
): Promise<LeadRow[]> {
  if (
    filter.silence_recent_hours === undefined ||
    filter.silence_recent_hours <= 0 ||
    leads.length === 0
  ) {
    return leads;
  }

  const cutoffIso = new Date(
    now.getTime() - filter.silence_recent_hours * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await db
    .from("conversations")
    .select("lead_id, last_message_at")
    .eq("organization_id", organizationId)
    .in(
      "lead_id",
      leads.map((lead) => lead.id),
    )
    .gte("last_message_at", cutoffIso);

  if (error) throw new Error(error.message);

  const silencedLeadIds = new Set(
    ((data ?? []) as Array<{ lead_id: string | null }>)
      .map((row) => row.lead_id)
      .filter((value): value is string => typeof value === "string"),
  );

  return leads.filter((lead) => !silencedLeadIds.has(lead.id));
}

async function loadConversationMap(
  db: AgentDb,
  organizationId: string,
  leadIds: string[],
): Promise<Map<string, string>> {
  if (leadIds.length === 0) return new Map();

  const { data, error } = await db
    .from("conversations")
    .select("id, lead_id, status, last_message_at, created_at")
    .eq("organization_id", organizationId)
    .in("lead_id", leadIds);

  if (error) throw new Error(error.message);

  const bestByLead = new Map<string, ConversationRow>();
  for (const row of (data ?? []) as ConversationRow[]) {
    const current = bestByLead.get(row.lead_id);
    if (!current || compareConversationPriority(row, current) < 0) {
      bestByLead.set(row.lead_id, row);
    }
  }

  return new Map(
    Array.from(bestByLead.entries()).map(([leadId, conversation]) => [
      leadId,
      conversation.id,
    ]),
  );
}

function compareConversationPriority(
  candidate: ConversationRow,
  current: ConversationRow,
): number {
  const candidateStatusScore = candidate.status === "active" ? 0 : 1;
  const currentStatusScore = current.status === "active" ? 0 : 1;
  if (candidateStatusScore !== currentStatusScore) {
    return candidateStatusScore - currentStatusScore;
  }

  const candidateTimestamp = Date.parse(
    candidate.last_message_at ?? candidate.created_at,
  );
  const currentTimestamp = Date.parse(current.last_message_at ?? current.created_at);
  return currentTimestamp - candidateTimestamp;
}

function normalizeTagName(value: string): string {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function extractTagName(row: Record<string, unknown>): string | null {
  const tags = row.tags;
  if (Array.isArray(tags)) {
    const first = tags[0];
    if (
      first &&
      typeof first === "object" &&
      !Array.isArray(first) &&
      typeof (first as { name?: unknown }).name === "string"
    ) {
      return (first as { name: string }).name;
    }
  }

  if (
    tags &&
    typeof tags === "object" &&
    !Array.isArray(tags) &&
    typeof (tags as { name?: unknown }).name === "string"
  ) {
    return (tags as { name: string }).name;
  }

  return null;
}
