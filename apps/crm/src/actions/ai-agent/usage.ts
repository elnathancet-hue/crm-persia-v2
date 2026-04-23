"use server";

import { type UsageStats, type UsageStatsInput } from "@persia/shared/ai-agent";
import {
  buildUsagePoints,
  loadActiveCostLimitSnapshots,
  loadUsageRows,
  resolveUsageRange,
  summarizeUsagePoints,
} from "@/lib/ai-agent/cost-limits";
import { assertConfigBelongsToOrg, requireAgentRole } from "./utils";

export async function getUsageStats(input: UsageStatsInput): Promise<UsageStats> {
  const { db, orgId } = await requireAgentRole("admin");
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
  const limits = await loadActiveCostLimitSnapshots({
    db,
    orgId,
    configId,
  });

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
