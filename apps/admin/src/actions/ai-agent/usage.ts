"use server";

import {
  type CostLimitScope,
  type UsagePoint,
  type UsageStats,
  type UsageStatsInput,
} from "@persia/shared/ai-agent";
import { fromAny } from "@/lib/ai-agent/db";
import { assertConfigBelongsToOrg, requireAdminAgentOrg } from "./utils";

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

export async function getUsageStats(
  orgId: string,
  input: UsageStatsInput,
): Promise<UsageStats> {
  const { db } = await requireAdminAgentOrg(orgId);
  const range = normalizeRange(input.range);
  const configId = input.config_id ?? null;

  if (configId) {
    await assertConfigBelongsToOrg(db, orgId, configId);
  }

  const window = resolveUsageRange(range);
  const rows = await loadUsageRows({
    db,
    orgId,
    startDay: window.startDay,
    endDay: window.endDay,
    configId,
  });
  const points = buildUsagePoints({
    rows,
    startDay: window.startDay,
    endDay: window.endDay,
  });
  const totals = summarizeUsagePoints(points);
  const limits = await loadActiveCostLimitSnapshots({ db, orgId, configId });

  return {
    range,
    organization_id: orgId,
    config_id: configId,
    points,
    totals,
    limits,
  };
}

function normalizeRange(range: UsageStatsInput["range"]): UsageStatsInput["range"] {
  if (["today", "last_7_days", "last_30_days", "month_to_date"].includes(range)) {
    return range;
  }
  return "last_7_days";
}

async function loadUsageRows(params: {
  db: Awaited<ReturnType<typeof requireAdminAgentOrg>>["db"];
  orgId: string;
  startDay: string;
  endDay: string;
  configId?: string | null;
}): Promise<UsageDailyRow[]> {
  let query = fromAny(params.db, "agent_usage_daily")
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
  return (data ?? []) as UsageDailyRow[];
}

function buildUsagePoints(params: {
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
    const rows = rowsByDay.get(day) ?? [];
    const runCount = rows.reduce((sum, row) => sum + row.run_count, 0);
    const weightedDuration = rows.reduce((sum, row) => sum + row.avg_duration_ms * row.run_count, 0);

    points.push({
      day,
      run_count: runCount,
      succeeded_count: rows.reduce((sum, row) => sum + row.succeeded_count, 0),
      failed_count: rows.reduce((sum, row) => sum + row.failed_count, 0),
      fallback_count: rows.reduce((sum, row) => sum + row.fallback_count, 0),
      tokens_input: rows.reduce((sum, row) => sum + row.tokens_input, 0),
      tokens_output: rows.reduce((sum, row) => sum + row.tokens_output, 0),
      cost_usd_cents: rows.reduce((sum, row) => sum + row.cost_usd_cents, 0),
      avg_duration_ms: runCount > 0 ? Math.round(weightedDuration / runCount) : 0,
    });
  }

  return points;
}

function summarizeUsagePoints(points: UsagePoint[]) {
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

async function loadActiveCostLimitSnapshots(params: {
  db: Awaited<ReturnType<typeof requireAdminAgentOrg>>["db"];
  orgId: string;
  configId: string | null;
}) {
  const { data: limits, error: limitsError } = await fromAny(params.db, "agent_cost_limits")
    .select("*")
    .eq("organization_id", params.orgId);
  if (limitsError) throw new Error(limitsError.message);

  const today = asUtcDate(new Date());
  const monthStart = monthStartUtcDay(new Date());
  const [todayRows, monthRows] = await Promise.all([
    loadUsageRows({ db: params.db, orgId: params.orgId, startDay: today, endDay: today }),
    loadUsageRows({ db: params.db, orgId: params.orgId, startDay: monthStart, endDay: today }),
  ]);

  const aggregate = (rows: UsageDailyRow[]) => ({
    used_tokens: rows.reduce((sum, row) => sum + row.tokens_input + row.tokens_output, 0),
    used_usd_cents: rows.reduce((sum, row) => sum + row.cost_usd_cents, 0),
  });

  const findLimit = (scope: string, subjectId: string | null) =>
    ((limits ?? []) as Array<Record<string, unknown>>).find(
      (row) => row.scope === scope && ((row.subject_id as string | null) ?? null) === subjectId,
    ) ?? null;

  const snapshot = (
    scope: string,
    subjectId: string | null,
    rows: UsageDailyRow[],
  ) => {
    const limit = findLimit(scope, subjectId);
    if (!limit) return null;
    const usage = aggregate(rows);
    const maxTokens = limit.max_tokens === null ? null : Number(limit.max_tokens);
    const maxUsdCents = limit.max_usd_cents === null ? null : Number(limit.max_usd_cents);
    const utilization = [maxTokens ? usage.used_tokens / maxTokens : null, maxUsdCents ? usage.used_usd_cents / maxUsdCents : null]
      .filter((value): value is number => value !== null && Number.isFinite(value))
      .reduce<number | null>((max, value) => (max === null ? value : Math.max(max, value)), null);

    return {
      scope: limit.scope as CostLimitScope,
      subject_id: (limit.subject_id as string | null) ?? null,
      max_tokens: maxTokens,
      max_usd_cents: maxUsdCents,
      used_tokens: usage.used_tokens,
      used_usd_cents: usage.used_usd_cents,
      utilization: utilization === null ? null : Math.max(0, Math.min(1, utilization)),
    };
  };

  return {
    org_daily: snapshot("org_daily", null, todayRows),
    org_monthly: snapshot("org_monthly", null, monthRows),
    agent_daily: params.configId
      ? snapshot(
          "agent_daily",
          params.configId,
          todayRows.filter((row) => row.config_id === params.configId),
        )
      : null,
  };
}

function resolveUsageRange(range: "today" | "last_7_days" | "last_30_days" | "month_to_date") {
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
