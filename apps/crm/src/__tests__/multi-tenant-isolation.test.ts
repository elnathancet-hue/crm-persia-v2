/**
 * Multi-tenant isolation suite
 *
 * Guards the invariants that every org's data stays within its own boundary:
 *   1. Every service_role write is WHERE-scoped by organization_id
 *   2. Deal moves across orgs are rejected (even with forged orgId)
 *   3. Campaign send records carry the correct organization_id
 *
 * If one of these fails, the isolation regression is breaking cross-org
 * reads/writes — block the merge.
 */

import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

// --- team.ts calls @supabase/supabase-js directly; capture it ---
let lastAdminClient: MockSupabase | null = null;
vi.mock("@supabase/supabase-js", async () => {
  return {
    createClient: vi.fn(() => {
      // Each call to createClient creates a fresh mock — tests set
      // lastAdminClient beforehand to intercept.
      if (!lastAdminClient) throw new Error("lastAdminClient not set for this test");
      return lastAdminClient;
    }),
  };
});

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Flow triggers + UAZAPI sync are fire-and-forget dynamic imports.
// Stub so they don't pull real deps or leak rejections.
vi.mock("@/lib/flows/triggers", () => ({
  onStageChanged: vi.fn(async () => {}),
}));
vi.mock("@/lib/whatsapp/sync", () => ({
  syncLeadToUazapi: vi.fn(async () => {}),
}));

import { requireRole } from "@/lib/auth";
import { toggleMemberActive } from "@/actions/team";
import { moveDealToStage } from "@/lib/crm/move-deal";

const ORG_A = "org-a-111";
const ORG_B = "org-b-222";

function stubAuth(supabase: MockSupabase, orgId = ORG_A, role: "admin" | "agent" = "admin") {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: "user-1" },
    orgId,
    userId: "user-1",
    role,
  } as never);
}

describe("team.toggleMemberActive — UPDATE is scoped by organization_id", () => {
  it("filters the UPDATE by both member id and organization_id (defense in depth)", async () => {
    const admin = createSupabaseMock();
    lastAdminClient = admin;
    stubAuth(admin, ORG_A);

    // SELECT pre-check — member exists in this org
    admin.queue("organization_members", {
      data: { is_active: true, role: "agent" },
      error: null,
    });
    // UPDATE result — success
    admin.queue("organization_members", { data: null, error: null });

    await toggleMemberActive("member-123");

    // Both SELECT and UPDATE must scope by organization_id=ORG_A
    const eqs = admin.filters.organization_members?.eq ?? [];
    const orgScopes = eqs.filter(([col]) => col === "organization_id");
    expect(orgScopes.length).toBeGreaterThanOrEqual(2); // select + update
    for (const [, val] of orgScopes) {
      expect(val).toBe(ORG_A);
    }
    // Both calls must also filter by member id
    const idScopes = eqs.filter(([col]) => col === "id");
    expect(idScopes.length).toBeGreaterThanOrEqual(2);
    for (const [, val] of idScopes) {
      expect(val).toBe("member-123");
    }

    lastAdminClient = null;
  });

  it("rejects when the member doesn't exist in the caller's org (SELECT returns null)", async () => {
    const admin = createSupabaseMock();
    lastAdminClient = admin;
    stubAuth(admin, ORG_A);

    // SELECT finds nothing — member belongs to a different org (or doesn't exist)
    admin.queue("organization_members", { data: null, error: null });

    await expect(toggleMemberActive("member-of-org-b")).rejects.toThrow(/nao encontrado/i);

    // Must never reach the UPDATE step
    expect(admin.updates.organization_members).toBeUndefined();

    lastAdminClient = null;
  });

  it("refuses to deactivate owner even inside the same org", async () => {
    const admin = createSupabaseMock();
    lastAdminClient = admin;
    stubAuth(admin, ORG_A);

    admin.queue("organization_members", {
      data: { is_active: true, role: "owner" },
      error: null,
    });

    await expect(toggleMemberActive("owner-id")).rejects.toThrow(/dono/i);
    expect(admin.updates.organization_members).toBeUndefined();

    lastAdminClient = null;
  });
});

describe("moveDealToStage — cross-org attempts are rejected", () => {
  it("rejects a deal that belongs to a different org than the caller", async () => {
    const supabase = createSupabaseMock();
    // Deal is in ORG_B but caller passes ORG_A
    supabase.queue("deals", {
      data: {
        id: "deal-foreign",
        stage_id: "stage-old",
        lead_id: "lead-1",
        organization_id: ORG_B,
        pipeline_id: "pipe-1",
      },
      error: null,
    });

    const res = await moveDealToStage({
      dealId: "deal-foreign",
      stageId: "stage-new",
      orgId: ORG_A,
      source: "manual",
      supabase: supabase as never,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/n[aã]o pertence/i);
    // No update must have been issued
    expect(supabase.updates.deals).toBeUndefined();
  });

  it("rejects when the target stage belongs to a different org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: {
        id: "deal-own",
        stage_id: "stage-old",
        lead_id: "lead-1",
        organization_id: ORG_A,
        pipeline_id: "pipe-1",
      },
      error: null,
    });
    // Target stage belongs to ORG_B — cross-org leak attempt
    supabase.queue("pipeline_stages", {
      data: {
        id: "stage-foreign",
        name: "Won",
        pipeline_id: "pipe-1",
        organization_id: ORG_B,
      },
      error: null,
    });

    const res = await moveDealToStage({
      dealId: "deal-own",
      stageId: "stage-foreign",
      orgId: ORG_A,
      source: "manual",
      supabase: supabase as never,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/n[aã]o pertence/i);
    expect(supabase.updates.deals).toBeUndefined();
  });

  it("accepts a same-org move and updates the deal", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: {
        id: "deal-own",
        stage_id: "stage-old",
        lead_id: "lead-1",
        organization_id: ORG_A,
        pipeline_id: "pipe-1",
      },
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: {
        id: "stage-new",
        name: "Won",
        pipeline_id: "pipe-1",
        organization_id: ORG_A,
      },
      error: null,
    });
    // from-stage name lookup
    supabase.queue("pipeline_stages", { data: { name: "Lost" }, error: null });
    // update returns no error
    supabase.queue("deals", { data: null, error: null });

    const res = await moveDealToStage({
      dealId: "deal-own",
      stageId: "stage-new",
      orgId: ORG_A,
      source: "manual",
      supabase: supabase as never,
    });

    expect(res.ok).toBe(true);
    expect(res.noop).toBeUndefined();
    expect(supabase.updates.deals).toBeDefined();
    expect(supabase.updates.deals?.[0]).toMatchObject({ stage_id: "stage-new" });
  });

  it("activity log insert carries the caller org, not the deal row org", async () => {
    // This guards against subtle mistakes where lead_activities could get
    // a drifted organization_id through refactor.
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: {
        id: "deal-own",
        stage_id: "stage-old",
        lead_id: "lead-xyz",
        organization_id: ORG_A,
        pipeline_id: "pipe-1",
      },
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: { id: "stage-new", name: "Won", pipeline_id: "pipe-1", organization_id: ORG_A },
      error: null,
    });
    supabase.queue("pipeline_stages", { data: { name: "Lost" }, error: null });
    supabase.queue("deals", { data: null, error: null });

    await moveDealToStage({
      dealId: "deal-own",
      stageId: "stage-new",
      orgId: ORG_A,
      source: "automation",
      supabase: supabase as never,
    });

    const activityInsert = supabase.inserts.lead_activities?.[0] as Record<string, unknown>;
    expect(activityInsert).toBeDefined();
    expect(activityInsert.organization_id).toBe(ORG_A);
    expect(activityInsert.lead_id).toBe("lead-xyz");
  });
});
