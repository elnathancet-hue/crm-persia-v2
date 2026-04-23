import {
  type ActiveCostLimits,
  type AgentCostLimit,
  type CostLimitSnapshot,
  type CostLimitScope,
  type UsagePoint,
  type UsagePointTotals,
} from "@persia/shared/ai-agent";
import { GuardrailError } from "./guardrails";
import { type AgentDb } from "./db";

interface UsageDailyRow {
  organization_id: string;
  config_id: string | null;
  day: string;
  run_count: number;
  succeeded_count: number;
  failed_count: number;
  fallback_count: number;
  tokens_input: number;
  tokens_output: number;
  cost_usd_cents: number;
  avg_duration_ms: number;
}

interface UsageAggregate {
  run_count: number;
  succeeded_count: number;
  failed_count: number;
  fallback_count: number;
  tokens_input: number;
  tokens_output: number;
  cost_usd_cents: number;
  avg_duration_ms: number;
}

export interface CostLimitCache {
  limits?: AgentCostLimit[];
  todayRows?: UsageDailyRow[];
  monthRows?: UsageDailyRow[];
}

export async function assertWithinCostLimits(params: {
  db: AgentDb;
  orgId: string;
  configId: string;
  agentConversationId: string;
  tokensSoFarRun: number;
  costSoFarRunUsdCents: number;
  guardrailsTokens?: number | null;
  cache?: CostLimitCache;
}): Promise<void> {
  const cache = params.cache ?? {};
  const limits = await loadCostLimitRows(params.db, params.orgId, cache);
  const runLimit = findLimit(limits, "run", null);

  if (
    params.guardrailsTokens !== undefined &&
    params.guardrailsTokens !== null &&
    params.tokensSoFarRun > params.guardrailsTokens
  ) {
    throw new GuardrailError("run_cost_tokens", "AI agent token ceiling reached");
  }

  if (runLimit?.max_tokens !== null && runLimit?.max_tokens !== undefined) {
    if (params.tokensSoFarRun > runLimit.max_tokens) {
      throw new GuardrailError("run_cost_tokens", "AI agent run token budget reached");
    }
  }

  if (runLimit?.max_usd_cents !== null && runLimit?.max_usd_cents !== undefined) {
    if (params.costSoFarRunUsdCents > runLimit.max_usd_cents) {
      throw new GuardrailError("run_cost_tokens", "AI agent run cost budget reached");
    }
  }

  const snapshots = await loadActiveCostLimitSnapshots({
    db: params.db,
    orgId: params.orgId,
    configId: params.configId,
    cache,
  });

  assertAggregateLimit(
    snapshots.agent_daily,
    params.tokensSoFarRun,
    params.costSoFarRunUsdCents,
    "agent_daily_tokens",
    "agent_daily_usd",
    "AI agent daily token budget reached",
    "AI agent daily cost budget reached",
  );

  assertAggregateLimit(
    snapshots.org_daily,
    params.tokensSoFarRun,
    params.costSoFarRunUsdCents,
    "org_daily_tokens",
    "org_daily_usd",
    "AI agent organization daily token budget reached",
    "AI agent organization daily cost budget reached",
  );

  assertAggregateLimit(
    snapshots.org_monthly,
    params.tokensSoFarRun,
    params.costSoFarRunUsdCents,
    "org_monthly_tokens",
    "org_monthly_usd",
    "AI agent organization monthly token budget reached",
    "AI agent organization monthly cost budget reached",
  );
}

export async function loadActiveCostLimitSnapshots(params: {
  db: AgentDb;
  orgId: string;
  configId?: string | null;
  cache?: CostLimitCache;
}): Promise<ActiveCostLimits> {
  const limits = await loadCostLimitRows(params.db, params.orgId, params.cache);
  const todayRows = await loadCurrentDayRows(params.db, params.orgId, params.cache);
  const monthRows = await loadCurrentMonthRows(params.db, params.orgId, params.cache);

  const orgDaily = summarizeUsageRows(todayRows);
  const orgMonthly = summarizeUsageRows(monthRows);
  const agentDaily = params.configId
    ? summarizeUsageRows(todayRows.filter((row) => row.config_id === params.configId))
    : emptyUsageAggregate();

  return {
    org_daily: buildSnapshot(findLimit(limits, "org_daily", null), orgDaily),
    org_monthly: buildSnapshot(findLimit(limits, "org_monthly", null), orgMonthly),
    agent_daily: params.configId
      ? buildSnapshot(findLimit(limits, "agent_daily", params.configId), agentDaily)
      : null,
  };
}

export async function loadUsageRows(params: {
  db: AgentDb;
  orgId: string;
  startDay: string;
  endDay: string;
  configId?: string | null;
}): Promise<UsageDailyRow[]> {
  let query = params.db
    .from("agent_usage_daily")
    .select("*")
    .eq("organization_id", params.orgId)
    .gte("day", params.startDay)
    .lte("day", params.endDay)
    .order("day", { ascending: true });

  if (params.configId) {
    query = query.eq("config_id", params.configId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return normalizeUsageRows(data ?? []);
}

export function buildUsagePoints(params: {
  rows: UsageDailyRow[];
  startDay: string;
  endDay: string;
}): UsagePoint[] {
  const rowsByDay = new Map<string, UsageDailyRow[]>();
  for (const row of params.rows) {
    const bucket = rowsByDay.get(row.day) ?? [];
    bucket.push(row);
    rowsByDay.set(row.day, bucket);
  }

  const points: UsagePoint[] = [];
  for (const day of listUtcDays(params.startDay, params.endDay)) {
    const aggregate = summarizeUsageRows(rowsByDay.get(day) ?? []);
    points.push({ day, ...aggregate });
  }
  return points;
}

export function summarizeUsagePoints(points: UsagePoint[]): UsagePointTotals {
  const totalRuns = points.reduce((sum, point) => sum + point.run_count, 0);
  const weightedDuration = points.reduce(
    (sum, point) => sum + point.avg_duration_ms * point.run_count,
    0,
  );

  return {
    run_count: totalRuns,
    succeeded_count: points.reduce((sum, point) => sum + point.succeeded_count, 0),
    failed_count: points.reduce((sum, point) => sum + point.failed_count, 0),
    fallback_count: points.reduce((sum, point) => sum + point.fallback_count, 0),
    tokens_input: points.reduce((sum, point) => sum + point.tokens_input, 0),
    tokens_output: points.reduce((sum, point) => sum + point.tokens_output, 0),
    cost_usd_cents: points.reduce((sum, point) => sum + point.cost_usd_cents, 0),
    avg_duration_ms: totalRuns > 0 ? Math.round(weightedDuration / totalRuns) : 0,
    success_rate:
      totalRuns > 0
        ? points.reduce((sum, point) => sum + point.succeeded_count, 0) / totalRuns
        : 0,
    fallback_rate:
      totalRuns > 0
        ? points.reduce((sum, point) => sum + point.fallback_count, 0) / totalRuns
        : 0,
  };
}

export function resolveUsageRange(range: "today" | "last_7_days" | "last_30_days" | "month_to_date"): {
  startDay: string;
  endDay: string;
} {
  const now = new Date();
  const end = asUtcDate(now);

  switch (range) {
    case "today":
      return { startDay: end, endDay: end };
    case "last_7_days":
      return { startDay: shiftUtcDay(end, -6), endDay: end };
    case "last_30_days":
      return { startDay: shiftUtcDay(end, -29), endDay: end };
    case "month_to_date":
      return { startDay: monthStartUtcDay(now), endDay: end };
    default:
      return { startDay: end, endDay: end };
  }
}

async function loadCostLimitRows(
  db: AgentDb,
  orgId: string,
  cache?: CostLimitCache,
): Promise<AgentCostLimit[]> {
  if (cache?.limits) return cache.limits;

  const { data, error } = await db
    .from("agent_cost_limits")
    .select("*")
    .eq("organization_id", orgId)
    .order("scope", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const limits = (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as unknown as AgentCostLimit),
    max_tokens: normalizeNullableNumber(row.max_tokens),
    max_usd_cents: normalizeNullableNumber(row.max_usd_cents),
  }));

  if (cache) cache.limits = limits;
  return limits;
}

async function loadCurrentDayRows(
  db: AgentDb,
  orgId: string,
  cache?: CostLimitCache,
): Promise<UsageDailyRow[]> {
  if (cache?.todayRows) return cache.todayRows;
  const day = asUtcDate(new Date());
  const rows = await loadUsageRows({ db, orgId, startDay: day, endDay: day });
  if (cache) cache.todayRows = rows;
  return rows;
}

async function loadCurrentMonthRows(
  db: AgentDb,
  orgId: string,
  cache?: CostLimitCache,
): Promise<UsageDailyRow[]> {
  if (cache?.monthRows) return cache.monthRows;
  const now = new Date();
  const rows = await loadUsageRows({
    db,
    orgId,
    startDay: monthStartUtcDay(now),
    endDay: asUtcDate(now),
  });
  if (cache) cache.monthRows = rows;
  return rows;
}

function normalizeUsageRows(rows: unknown[]): UsageDailyRow[] {
  return rows.map((row) => {
    const value = row as Record<string, unknown>;
    return {
      organization_id: String(value.organization_id),
      config_id: value.config_id ? String(value.config_id) : null,
      day: normalizeDay(value.day),
      run_count: normalizeNumber(value.run_count),
      succeeded_count: normalizeNumber(value.succeeded_count),
      failed_count: normalizeNumber(value.failed_count),
      fallback_count: normalizeNumber(value.fallback_count),
      tokens_input: normalizeNumber(value.tokens_input),
      tokens_output: normalizeNumber(value.tokens_output),
      cost_usd_cents: normalizeNumber(value.cost_usd_cents),
      avg_duration_ms: normalizeNumber(value.avg_duration_ms),
    };
  });
}

function summarizeUsageRows(rows: UsageDailyRow[]): UsageAggregate {
  const runCount = rows.reduce((sum, row) => sum + row.run_count, 0);
  const weightedDuration = rows.reduce((sum, row) => sum + row.avg_duration_ms * row.run_count, 0);

  return {
    run_count: runCount,
    succeeded_count: rows.reduce((sum, row) => sum + row.succeeded_count, 0),
    failed_count: rows.reduce((sum, row) => sum + row.failed_count, 0),
    fallback_count: rows.reduce((sum, row) => sum + row.fallback_count, 0),
    tokens_input: rows.reduce((sum, row) => sum + row.tokens_input, 0),
    tokens_output: rows.reduce((sum, row) => sum + row.tokens_output, 0),
    cost_usd_cents: rows.reduce((sum, row) => sum + row.cost_usd_cents, 0),
    avg_duration_ms: runCount > 0 ? Math.round(weightedDuration / runCount) : 0,
  };
}

function emptyUsageAggregate(): UsageAggregate {
  return {
    run_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    fallback_count: 0,
    tokens_input: 0,
    tokens_output: 0,
    cost_usd_cents: 0,
    avg_duration_ms: 0,
  };
}

function findLimit(
  limits: AgentCostLimit[],
  scope: CostLimitScope,
  subjectId: string | null,
): AgentCostLimit | null {
  return (
    limits.find((limit) => limit.scope === scope && (limit.subject_id ?? null) === subjectId) ?? null
  );
}

function buildSnapshot(limit: AgentCostLimit | null, aggregate: UsageAggregate): CostLimitSnapshot | null {
  if (!limit) return null;

  const usedTokens = aggregate.tokens_input + aggregate.tokens_output;
  const tokenRatio =
    limit.max_tokens !== null && limit.max_tokens !== undefined && limit.max_tokens > 0
      ? usedTokens / limit.max_tokens
      : null;
  const usdRatio =
    limit.max_usd_cents !== null &&
    limit.max_usd_cents !== undefined &&
    limit.max_usd_cents > 0
      ? aggregate.cost_usd_cents / limit.max_usd_cents
      : null;
  const utilization = [tokenRatio, usdRatio]
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .reduce<number | null>((max, value) => (max === null ? value : Math.max(max, value)), null);

  return {
    scope: limit.scope,
    subject_id: limit.subject_id,
    max_tokens: limit.max_tokens,
    max_usd_cents: limit.max_usd_cents,
    used_tokens: usedTokens,
    used_usd_cents: aggregate.cost_usd_cents,
    utilization: utilization === null ? null : Math.max(0, Math.min(1, utilization)),
  };
}

function assertAggregateLimit(
  snapshot: CostLimitSnapshot | null,
  tokensSoFarRun: number,
  costSoFarRunUsdCents: number,
  tokenReason: "agent_daily_tokens" | "org_daily_tokens" | "org_monthly_tokens",
  usdReason: "agent_daily_usd" | "org_daily_usd" | "org_monthly_usd",
  tokenMessage: string,
  usdMessage: string,
): void {
  if (!snapshot) return;

  if (snapshot.max_tokens !== null && snapshot.max_tokens !== undefined) {
    if (snapshot.used_tokens + tokensSoFarRun > snapshot.max_tokens) {
      throw new GuardrailError(tokenReason, tokenMessage);
    }
  }

  if (snapshot.max_usd_cents !== null && snapshot.max_usd_cents !== undefined) {
    if (snapshot.used_usd_cents + costSoFarRunUsdCents > snapshot.max_usd_cents) {
      throw new GuardrailError(usdReason, usdMessage);
    }
  }
}

function normalizeNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : normalizeNumber(value);
}

function normalizeDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function asUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function monthStartUtcDay(value: Date): string {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function shiftUtcDay(day: string, offset: number): string {
  const base = new Date(`${day}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

function listUtcDays(startDay: string, endDay: string): string[] {
  const days: string[] = [];
  for (let current = startDay; current <= endDay; current = shiftUtcDay(current, 1)) {
    days.push(current);
  }
  return days;
}
