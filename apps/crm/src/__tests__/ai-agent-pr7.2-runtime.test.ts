import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentConfig,
  AgentNotificationTemplate,
  AgentScheduledJob,
  LeadFilter,
} from "@persia/shared/ai-agent";
import { computeNextScheduledRunAt } from "@/lib/ai-agent/scheduler/cron-parser";
import { resolveScheduledJobLeads } from "@/lib/ai-agent/scheduler/lead-resolver";
import { runScheduledTick } from "@/lib/ai-agent/scheduler/tick";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  getRequestId: vi.fn(() => "req-pr7-scheduler"),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const providerMock = vi.hoisted(() => ({
  name: "uazapi",
  sendText: vi.fn(async () => ({ success: true, messageId: "msg-a" })),
}));

const createProviderMock = vi.hoisted(() => vi.fn(() => providerMock));

vi.mock("@/lib/whatsapp/providers", () => ({
  createProvider: createProviderMock,
}));

function job(overrides: Partial<AgentScheduledJob & { claimed_at?: string | null }> = {}) {
  return {
    id: "job-a",
    organization_id: "org-a",
    config_id: "config-a",
    name: "Lembrete diario",
    template_id: "template-a",
    cron_expr: "0 9 * * *",
    lead_filter: { statuses: ["novo"] } satisfies LeadFilter,
    status: "active",
    last_run_at: null,
    last_run_leads_processed: 0,
    last_run_error: null,
    next_run_at: "2026-04-25T09:00:00.000Z",
    created_at: "2026-04-25T00:00:00.000Z",
    updated_at: "2026-04-25T00:00:00.000Z",
    claimed_at: null,
    ...overrides,
  };
}

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "config-a",
    organization_id: "org-a",
    name: "Recepcao",
    description: null,
    scope_type: "global",
    scope_id: null,
    model: "gpt-5-mini",
    system_prompt: "Voce atende clientes.",
    guardrails: {
      max_iterations: 5,
      timeout_seconds: 30,
      cost_ceiling_tokens: 20_000,
      allow_human_handoff: true,
    },
    debounce_window_ms: 10000,
    context_summary_turn_threshold: 10,
    context_summary_token_threshold: 20000,
    context_summary_recent_messages: 6,
    handoff_notification_enabled: false,
    handoff_notification_target_type: null,
    handoff_notification_target_address: null,
    handoff_notification_template: null,
    status: "active",
    created_at: "2026-04-25T00:00:00.000Z",
    updated_at: "2026-04-25T00:00:00.000Z",
    ...overrides,
  };
}

function template(
  overrides: Partial<AgentNotificationTemplate> = {},
): AgentNotificationTemplate {
  return {
    id: "template-a",
    organization_id: "org-a",
    config_id: "config-a",
    name: "lead_qualificado",
    description: "Notify sales about a qualified lead.",
    target_type: "group",
    target_address: "120363940120011111@g.us",
    body_template: "Lead {{lead_name}} - {{wa_link}}",
    status: "active",
    created_at: "2026-04-25T00:00:00.000Z",
    updated_at: "2026-04-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("ai-agent PR7.2 scheduler runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PERSIA_APP_URL = "https://crm.funilpersia.top";
  });

  it("migration 025 claim only picks active due jobs and honors stale leases", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/025_ai_agent_scheduled_jobs.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("j.status = 'active'");
    expect(sql).toContain("j.next_run_at <= p_now");
    expect(sql).toContain("j.claimed_at < p_now - INTERVAL '5 minutes'");
  });

  it("computes next_run_at from cron expressions via cron-parser", () => {
    const nextRun = computeNextScheduledRunAt(
      "0 9 * * *",
      "2026-04-25T09:30:00.000Z",
    );

    expect(nextRun).toBe("2026-04-26T09:00:00.000Z");
  });

  it("fails the job cleanly when the template is archived", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("rpc:claim_agent_scheduled_job", {
      data: [job()],
      error: null,
    });
    supabase.queue("agent_configs", {
      data: { id: "config-a", name: "Recepcao" },
      error: null,
    });
    supabase.queue("agent_notification_templates", {
      data: template({ status: "archived" }),
      error: null,
    });
    supabase.queue("rpc:fail_agent_scheduled_job", {
      data: true,
      error: null,
    });

    const result = await runScheduledTick(supabase as never);

    expect(result.failed_jobs).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.error_samples).toEqual([]);
    expect(supabase.rpcCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fn: "claim_agent_scheduled_job" }),
        expect.objectContaining({
          fn: "fail_agent_scheduled_job",
          args: expect.objectContaining({
            p_job_id: "job-a",
            p_error_message: "notification template is archived",
          }),
        }),
      ]),
    );
  });

  it("silence_recent_hours filters out leads with recent conversation activity", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: [
        {
          id: "lead-old",
          name: "Lead antigo",
          phone: "5511999990001",
          status: "novo",
          created_at: "2026-04-20T00:00:00.000Z",
        },
        {
          id: "lead-recent",
          name: "Lead recente",
          phone: "5511999990002",
          status: "novo",
          created_at: "2026-04-20T00:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("conversations", {
      data: [
        {
          lead_id: "lead-recent",
          last_message_at: "2026-04-25T09:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("conversations", {
      data: [
        {
          id: "crm-old",
          lead_id: "lead-old",
          status: "active",
          last_message_at: "2026-04-20T10:00:00.000Z",
          created_at: "2026-04-20T10:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await resolveScheduledJobLeads({
      db: supabase as never,
      organizationId: "org-a",
      configId: "config-a",
      filter: { silence_recent_hours: 6, statuses: ["novo"] },
      now: new Date("2026-04-25T12:00:00.000Z"),
    });

    expect(result.leads).toEqual([
      expect.objectContaining({ id: "lead-old", crmConversationId: "crm-old" }),
    ]);
  });

  it("only_active_agents filters out leads already handed off to humans", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: [
        {
          id: "lead-active",
          name: "Ativo",
          phone: "5511999990001",
          status: "novo",
          created_at: "2026-04-20T00:00:00.000Z",
        },
        {
          id: "lead-handoff",
          name: "Humano",
          phone: "5511999990002",
          status: "novo",
          created_at: "2026-04-20T00:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("agent_conversations", {
      data: [
        { lead_id: "lead-active", human_handoff_at: null },
        { lead_id: "lead-handoff", human_handoff_at: "2026-04-24T00:00:00.000Z" },
      ],
      error: null,
    });
    supabase.queue("conversations", {
      data: [
        {
          id: "crm-active",
          lead_id: "lead-active",
          status: "active",
          last_message_at: "2026-04-20T10:00:00.000Z",
          created_at: "2026-04-20T10:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await resolveScheduledJobLeads({
      db: supabase as never,
      organizationId: "org-a",
      configId: "config-a",
      filter: { only_active_agents: true, statuses: ["novo"] },
    });

    expect(result.leads).toEqual([
      expect.objectContaining({ id: "lead-active" }),
    ]);
  });

  it("processes at most 500 leads and marks the overflow as skipped", async () => {
    const supabase = createSupabaseMock();
    createProviderMock.mockReturnValue(providerMock);

    supabase.queue("rpc:claim_agent_scheduled_job", {
      data: [job({ lead_filter: { statuses: ["novo"] } })],
      error: null,
    });
    supabase.queue("agent_configs", {
      data: { id: "config-a", name: "Recepcao" },
      error: null,
    });
    supabase.queue("agent_notification_templates", {
      data: template(),
      error: null,
    });
    supabase.queue("whatsapp_connections", {
      data: {
        provider: "uazapi",
        instance_url: "https://example.com",
        instance_token: "token",
      },
      error: null,
    });
    supabase.queue("leads", {
      data: Array.from({ length: 600 }, (_, index) => ({
        id: `lead-${index}`,
        name: `Lead ${index}`,
        phone: `55119999${String(index).padStart(4, "0")}`,
        status: "novo",
        created_at: "2026-04-20T00:00:00.000Z",
      })),
      error: null,
    });
    supabase.queue("conversations", {
      data: [],
      error: null,
    });
    supabase.queue("rpc:complete_agent_scheduled_job", {
      data: true,
      error: null,
    });

    const result = await runScheduledTick(supabase as never);

    expect(result.leads_matched).toBe(600);
    expect(result.leads_processed).toBe(500);
    expect(result.leads_skipped).toBe(100);
    expect(providerMock.sendText).toHaveBeenCalledTimes(500);
  });

  it("keeps every scheduler query scoped to the current organization", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: [
        {
          id: "lead-a",
          name: "Lead A",
          phone: "5511999990001",
          status: "novo",
          created_at: "2026-04-20T00:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("lead_tags", {
      data: [
        {
          lead_id: "lead-a",
          tags: { name: "vip" },
        },
      ],
      error: null,
    });
    supabase.queue("deals", {
      data: [{ lead_id: "lead-a", stage_id: "stage-a" }],
      error: null,
    });
    supabase.queue("agent_conversations", {
      data: [{ lead_id: "lead-a", human_handoff_at: null }],
      error: null,
    });
    supabase.queue("conversations", {
      data: [],
      error: null,
    });
    supabase.queue("conversations", {
      data: [],
      error: null,
    });

    await resolveScheduledJobLeads({
      db: supabase as never,
      organizationId: "org-a",
      configId: "config-a",
      filter: {
        tag_slugs: ["vip"],
        pipeline_stage_ids: ["stage-a"],
        statuses: ["novo"],
        only_active_agents: true,
        silence_recent_hours: 12,
      },
    });

    expect(supabase.filters.leads.eq).toContainEqual(["organization_id", "org-a"]);
    expect(supabase.filters.lead_tags.eq).toContainEqual([
      "organization_id",
      "org-a",
    ]);
    expect(supabase.filters.deals.eq).toContainEqual(["organization_id", "org-a"]);
    expect(supabase.filters.agent_conversations.eq).toContainEqual([
      "organization_id",
      "org-a",
    ]);
    expect(supabase.filters.conversations.eq).toContainEqual([
      "organization_id",
      "org-a",
    ]);
  });
});
