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

// server-only throws in test env; stub it out since we're exercising
// server-module imports (audit.ts, admin.ts).
vi.mock("server-only", () => ({}));

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

// The CRM audit helper writes to admin_audit_log via a fresh service-role
// client. For isolation assertions we don't care about audit writes — mock
// it to a noop so the toggleMemberActive path doesn't demand extra queue setup.
vi.mock("@/lib/audit", () => ({
  auditLog: vi.fn(async () => {}),
  auditFailure: vi.fn(async () => {}),
  withAuditedAdmin: vi.fn(async (_meta: unknown, fn: (admin: unknown) => Promise<unknown>) => {
    if (!lastAdminClient) throw new Error("lastAdminClient not set for this test");
    return fn(lastAdminClient);
  }),
}));

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

const ORG_A = "org-a-111";

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

// PR-K-CENTRIC cleanup (mai/2026): describe `moveDealToStage` removido.
// Movimentacao agora vai por moveLeadToStage (lead-centric) — cobertura
// multi-tenant equivalente em multi-tenant.test.ts via `moveLeadKanban`
// e `bulkMoveLeads`, que ja filtram por organization_id em todas as
// queries (assertions identicas as removidas aqui: rejeita cross-org
// no SELECT, nao atualiza no UPDATE, activity log carrega caller org).
