import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { assertWithinCostLimits } from "@/lib/ai-agent/cost-limits";
import { assertWithinRateLimits } from "@/lib/ai-agent/rate-limits";
import { setCostLimit, deleteCostLimit } from "@/actions/ai-agent/limits";
import { getUsageStats } from "@/actions/ai-agent/usage";

const ORG_A = "org-a";

function stubAuth(supabase: MockSupabase, role: "admin" | "agent" = "admin") {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: "user-1" },
    orgId: ORG_A,
    userId: "user-1",
    role,
  } as never);
}

describe("ai-agent PR4 runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      name: "run token limit",
      limits: [{ scope: "run", max_tokens: 100, max_usd_cents: null, subject_id: null }],
      tokens: 101,
      usd: 0,
      reason: "run_cost_tokens",
    },
    {
      name: "run usd limit",
      limits: [{ scope: "run", max_tokens: null, max_usd_cents: 10, subject_id: null }],
      tokens: 0,
      usd: 11,
      reason: "run_cost_tokens",
    },
    {
      name: "agent daily token limit",
      limits: [{ scope: "agent_daily", max_tokens: 100, max_usd_cents: null, subject_id: "config-a" }],
      usageRows: [{
        organization_id: ORG_A,
        config_id: "config-a",
        day: "2026-04-23",
        run_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        fallback_count: 0,
        tokens_input: 40,
        tokens_output: 40,
        cost_usd_cents: 2,
        avg_duration_ms: 100,
      }],
      tokens: 21,
      usd: 0,
      reason: "agent_daily_tokens",
    },
    {
      name: "agent daily usd limit",
      limits: [{ scope: "agent_daily", max_tokens: null, max_usd_cents: 10, subject_id: "config-a" }],
      usageRows: [{
        organization_id: ORG_A,
        config_id: "config-a",
        day: "2026-04-23",
        run_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        fallback_count: 0,
        tokens_input: 10,
        tokens_output: 10,
        cost_usd_cents: 8,
        avg_duration_ms: 100,
      }],
      tokens: 0,
      usd: 3,
      reason: "agent_daily_usd",
    },
    {
      name: "org daily token limit",
      limits: [{ scope: "org_daily", max_tokens: 100, max_usd_cents: null, subject_id: null }],
      usageRows: [{
        organization_id: ORG_A,
        config_id: "config-b",
        day: "2026-04-23",
        run_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        fallback_count: 0,
        tokens_input: 60,
        tokens_output: 30,
        cost_usd_cents: 5,
        avg_duration_ms: 100,
      }],
      tokens: 11,
      usd: 0,
      reason: "org_daily_tokens",
    },
    {
      name: "org daily usd limit",
      limits: [{ scope: "org_daily", max_tokens: null, max_usd_cents: 10, subject_id: null }],
      usageRows: [{
        organization_id: ORG_A,
        config_id: "config-b",
        day: "2026-04-23",
        run_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        fallback_count: 0,
        tokens_input: 10,
        tokens_output: 10,
        cost_usd_cents: 9,
        avg_duration_ms: 100,
      }],
      tokens: 0,
      usd: 2,
      reason: "org_daily_usd",
    },
    {
      name: "org monthly token limit",
      limits: [{ scope: "org_monthly", max_tokens: 200, max_usd_cents: null, subject_id: null }],
      usageRows: [{
        organization_id: ORG_A,
        config_id: "config-b",
        day: "2026-04-10",
        run_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        fallback_count: 0,
        tokens_input: 100,
        tokens_output: 90,
        cost_usd_cents: 9,
        avg_duration_ms: 100,
      }],
      tokens: 11,
      usd: 0,
      reason: "org_monthly_tokens",
    },
    {
      name: "org monthly usd limit",
      limits: [{ scope: "org_monthly", max_tokens: null, max_usd_cents: 10, subject_id: null }],
      usageRows: [{
        organization_id: ORG_A,
        config_id: "config-b",
        day: "2026-04-10",
        run_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        fallback_count: 0,
        tokens_input: 10,
        tokens_output: 10,
        cost_usd_cents: 9,
        avg_duration_ms: 100,
      }],
      tokens: 0,
      usd: 2,
      reason: "org_monthly_usd",
    },
  ])("assertWithinCostLimits trips $name", async ({ limits, usageRows, tokens, usd, reason }) => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_cost_limits", {
      data: limits.map((limit, index) => ({
        id: `limit-${index}`,
        organization_id: ORG_A,
        created_at: "2026-04-23T00:00:00.000Z",
        updated_at: "2026-04-23T00:00:00.000Z",
        ...limit,
      })),
      error: null,
    });
    supabase.queue("agent_usage_daily", {
      data: usageRows ?? [],
      error: null,
    });
    supabase.queue("agent_usage_daily", {
      data: usageRows ?? [],
      error: null,
    });

    await expect(
      assertWithinCostLimits({
        db: supabase as never,
        orgId: ORG_A,
        configId: "config-a",
        agentConversationId: "agent-conv-a",
        tokensSoFarRun: tokens,
        costSoFarRunUsdCents: usd,
      }),
    ).rejects.toMatchObject({
      reason,
    });
  });

  it("assertWithinRateLimits trips conversation rolling window", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", {
      data: new Array(6).fill(null).map((_, index) => ({ id: `run-${index}` })),
      error: null,
    });
    supabase.queue("agent_runs", {
      data: [],
      error: null,
    });

    await expect(
      assertWithinRateLimits({
        db: supabase as never,
        orgId: ORG_A,
        agentConversationId: "agent-conv-a",
      }),
    ).rejects.toMatchObject({
      reason: "rate_limit_conversation",
    });
  });

  it("assertWithinRateLimits trips org concurrent limit", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", {
      data: [],
      error: null,
    });
    supabase.queue("agent_runs", {
      data: new Array(20).fill(null).map((_, index) => ({ id: `run-${index}` })),
      error: null,
    });

    await expect(
      assertWithinRateLimits({
        db: supabase as never,
        orgId: ORG_A,
        agentConversationId: "agent-conv-a",
      }),
    ).rejects.toMatchObject({
      reason: "rate_limit_org_concurrent",
    });
  });

  it("getUsageStats scopes to org, resolves range and computes totals math", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", {
      data: { id: "config-a", organization_id: ORG_A },
      error: null,
    });
    supabase.queue("agent_usage_daily", {
      data: [
        {
          organization_id: ORG_A,
          config_id: "config-a",
          day: "2026-04-17",
          run_count: 2,
          succeeded_count: 1,
          failed_count: 1,
          fallback_count: 0,
          tokens_input: 20,
          tokens_output: 10,
          cost_usd_cents: 3,
          avg_duration_ms: 100,
        },
        {
          organization_id: ORG_A,
          config_id: "config-a",
          day: "2026-04-23",
          run_count: 3,
          succeeded_count: 2,
          failed_count: 0,
          fallback_count: 1,
          tokens_input: 30,
          tokens_output: 20,
          cost_usd_cents: 7,
          avg_duration_ms: 200,
        },
      ],
      error: null,
    });
    supabase.queue("agent_cost_limits", {
      data: [
        {
          id: "limit-agent",
          organization_id: ORG_A,
          scope: "agent_daily",
          subject_id: "config-a",
          max_tokens: 100,
          max_usd_cents: 20,
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        },
        {
          id: "limit-org-day",
          organization_id: ORG_A,
          scope: "org_daily",
          subject_id: null,
          max_tokens: 500,
          max_usd_cents: 50,
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("agent_usage_daily", {
      data: [
        {
          organization_id: ORG_A,
          config_id: "config-a",
          day: "2026-04-23",
          run_count: 3,
          succeeded_count: 2,
          failed_count: 0,
          fallback_count: 1,
          tokens_input: 30,
          tokens_output: 20,
          cost_usd_cents: 7,
          avg_duration_ms: 200,
        },
      ],
      error: null,
    });
    supabase.queue("agent_usage_daily", {
      data: [
        {
          organization_id: ORG_A,
          config_id: "config-a",
          day: "2026-04-17",
          run_count: 2,
          succeeded_count: 1,
          failed_count: 1,
          fallback_count: 0,
          tokens_input: 20,
          tokens_output: 10,
          cost_usd_cents: 3,
          avg_duration_ms: 100,
        },
        {
          organization_id: ORG_A,
          config_id: "config-a",
          day: "2026-04-23",
          run_count: 3,
          succeeded_count: 2,
          failed_count: 0,
          fallback_count: 1,
          tokens_input: 30,
          tokens_output: 20,
          cost_usd_cents: 7,
          avg_duration_ms: 200,
        },
      ],
      error: null,
    });

    const stats = await getUsageStats({
      config_id: "config-a",
      range: "last_7_days",
    });

    expect(stats.organization_id).toBe(ORG_A);
    expect(stats.config_id).toBe("config-a");
    expect(stats.points).toHaveLength(7);
    expect(stats.totals.run_count).toBe(5);
    expect(stats.totals.succeeded_count).toBe(3);
    expect(stats.totals.failed_count).toBe(1);
    expect(stats.totals.fallback_count).toBe(1);
    expect(stats.totals.tokens_input).toBe(50);
    expect(stats.totals.tokens_output).toBe(30);
    expect(stats.totals.cost_usd_cents).toBe(10);
    expect(stats.totals.avg_duration_ms).toBe(160);
    expect(stats.totals.success_rate).toBeCloseTo(0.6);
    expect(stats.totals.fallback_rate).toBeCloseTo(0.2);
    expect(stats.limits.agent_daily?.used_tokens).toBe(50);
    expect(supabase.filters.agent_usage_daily.eq).toContainEqual(["organization_id", ORG_A]);
  });

  it("setCostLimit upserts idempotently and deleteCostLimit removes the row", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", {
      data: { id: "config-a", organization_id: ORG_A },
      error: null,
    });
    supabase.queue("agent_cost_limits", {
      data: [],
      error: null,
    });
    supabase.queue("agent_cost_limits", {
      data: {
        id: "limit-a",
        organization_id: ORG_A,
        scope: "agent_daily",
        subject_id: "config-a",
        max_tokens: 100,
        max_usd_cents: 10,
        created_at: "2026-04-23T00:00:00.000Z",
        updated_at: "2026-04-23T00:00:00.000Z",
      },
      error: null,
    });

    const created = await setCostLimit({
      scope: "agent_daily",
      subject_id: "config-a",
      max_tokens: 100,
      max_usd_cents: 10,
    });

    expect(created.id).toBe("limit-a");
    expect(supabase.inserts.agent_cost_limits?.[0]).toMatchObject({
      organization_id: ORG_A,
      scope: "agent_daily",
      subject_id: "config-a",
    });

    supabase.queue("agent_configs", {
      data: { id: "config-a", organization_id: ORG_A },
      error: null,
    });
    supabase.queue("agent_cost_limits", {
      data: [created],
      error: null,
    });
    supabase.queue("agent_cost_limits", {
      data: {
        ...created,
        max_tokens: 120,
        updated_at: "2026-04-23T12:00:00.000Z",
      },
      error: null,
    });

    const updated = await setCostLimit({
      scope: "agent_daily",
      subject_id: "config-a",
      max_tokens: 120,
      max_usd_cents: 10,
    });

    expect(updated.max_tokens).toBe(120);
    expect(supabase.updates.agent_cost_limits?.[0]).toMatchObject({
      max_tokens: 120,
    });

    supabase.queue("agent_cost_limits", {
      data: updated,
      error: null,
    });
    supabase.queue("agent_cost_limits", {
      data: null,
      error: null,
    });

    await deleteCostLimit("limit-a");

    expect(supabase.deletes.agent_cost_limits).toBe(true);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/automations/agents");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/automations/agents/config-a");
  });

  it("migration 018 creates cost limit table, usage view and org-scoped policies", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/018_ai_agent_cost_limits.sql"),
      "utf8",
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.agent_cost_limits");
    expect(sql).toContain("ALTER TABLE public.agent_cost_limits ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('CREATE POLICY "agent_cost_limits_select"');
    expect(sql).toContain("get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.agent_usage_daily");
    expect(sql).toContain("WITH (security_invoker = true)");
    expect(sql).toContain("JOIN public.agent_conversations c ON c.id = r.agent_conversation_id");
  });
});
