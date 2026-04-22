/**
 * Multi-tenant isolation suite — entity level
 *
 * Complements multi-tenant-isolation.test.ts (which covers team + deals).
 * This suite validates that the CRM server actions for the main business
 * entities (leads, conversations, messages, tags, pipeline stages) only
 * operate on data that belongs to the caller's org.
 *
 * ---
 *
 * **Known limitation of these tests**
 *
 * These are unit tests backed by a chainable Supabase mock. They validate
 * the *application-level* scoping that each action applies before sending
 * queries to Supabase — i.e. every SELECT/UPDATE/DELETE carries an
 * `.eq("organization_id", orgId)` filter. They do NOT execute against a
 * real Postgres, so they cannot prove that RLS policies themselves reject
 * cross-org reads at the database layer.
 *
 * The defense-in-depth model is three layered:
 *   1. `requireRole()` rejects unauthenticated callers         ← unit-tested
 *   2. Actions scope every query by organization_id            ← THIS SUITE
 *   3. RLS policies enforce organization_id at the DB layer    ← needs SQL tests
 *
 * For layer 3, run the manual SQL checks documented in
 * `apps/crm/supabase/MULTI_TENANT_RLS_CHECKS.sql` (see README).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-request-id": "test" })),
}));
// Fire-and-forget dynamic import inside leads/tags actions — stub it so the
// test doesn't pull real deps or leak unhandled rejections.
vi.mock("@/lib/whatsapp/sync", () => ({
  syncLeadToUazapi: vi.fn(async () => {}),
}));
// messages.ts calls createAdminClient() to sign chat-media URLs. Stub the
// storage path so we don't need a real admin client.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: null })) })),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: null, error: null })),
      })),
    },
  })),
}));
vi.mock("@/lib/chat-media", () => ({
  CHAT_MEDIA_BUCKET: "chat-media",
  createChatMediaPath: vi.fn(() => ""),
  ensureChatMediaBucket: vi.fn(async () => {}),
  resolveChatMediaUrl: vi.fn(async () => null),
  resolveProviderChatMediaUrl: vi.fn(async () => null),
  toChatMediaRef: vi.fn(() => null),
  withSignedChatMediaUrls: vi.fn(async (_admin: unknown, msgs: unknown[]) => msgs),
}));
vi.mock("@/lib/whatsapp/providers", () => ({
  createProvider: vi.fn(),
}));

import { requireRole } from "@/lib/auth";
import {
  getLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  addTagToLead,
} from "@/actions/leads";
import {
  getConversations,
  getConversation,
  assignConversation,
  markConversationAsRead,
} from "@/actions/conversations";
import { getMessages } from "@/actions/messages";
import {
  createTag,
  updateTag,
  deleteTag,
  removeTagFromLead,
  getLeadTags,
} from "@/actions/tags";
import { createStage } from "@/actions/pipelines";

const ORG_A = "org-a-111";
const ORG_B = "org-b-222";

function stubAuth(
  supabase: MockSupabase,
  orgId = ORG_A,
  role: "admin" | "agent" | "owner" = "agent",
) {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: "user-1" },
    orgId,
    userId: "user-1",
    role,
  } as never);
}

function expectEveryEqOrgIsCaller(filters: MockSupabase["filters"], table: string) {
  const eqs = filters[table]?.eq ?? [];
  const orgScopes = eqs.filter(([col]) => col === "organization_id");
  expect(orgScopes.length).toBeGreaterThanOrEqual(1);
  for (const [, val] of orgScopes) expect(val).toBe(ORG_A);
}

function formOf(obj: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) fd.set(k, v);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// LEADS
// ============================================================
describe("leads — every query scopes by caller's organization_id", () => {
  it("getLeads filters by organization_id", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: [], error: null, count: 0 });

    await getLeads();

    expectEveryEqOrgIsCaller(supabase.filters, "leads");
  });

  it("getLead(id) scopes the primary select by org and refuses cross-org ids", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    // Simulates: caller tried to fetch a lead that belongs to ORG_B — the
    // .eq("organization_id", orgId) filter returns no row, so the action
    // throws. This is the real-world cross-org probe.
    supabase.queue("leads", {
      data: null,
      error: { message: "PGRST116: no rows" },
    });

    await expect(getLead("lead-from-org-b")).rejects.toThrow();

    const eqs = supabase.filters.leads?.eq ?? [];
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["id", "lead-from-org-b"],
        ["organization_id", ORG_A],
      ]),
    );
  });

  it("createLead writes the caller's organization_id on INSERT", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: null, error: null }); // dedup lookup
    supabase.queue("leads", { data: { id: "new" }, error: null }); // insert

    await createLead(formOf({ name: "Ana", phone: "5511" }));

    const inserted = supabase.inserts.leads?.[0] as Record<string, unknown>;
    expect(inserted.organization_id).toBe(ORG_A);
  });

  it("updateLead scopes the UPDATE by organization_id", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: { id: "l1" }, error: null });

    await updateLead("l1", formOf({ status: "qualified" }));

    expectEveryEqOrgIsCaller(supabase.filters, "leads");
  });

  it("deleteLead scopes the DELETE by organization_id", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: null, error: null });

    await deleteLead("l1");

    expectEveryEqOrgIsCaller(supabase.filters, "leads");
    expect(supabase.deletes.leads).toBe(true);
  });

  it("addTagToLead refuses a lead from another org", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    // lead lookup returns null — scoped select can't find foreign lead
    supabase.queue("leads", { data: null, error: null });

    await expect(addTagToLead("lead-foreign", "tag-1")).rejects.toThrow(
      /n[aã]o encontrado/i,
    );
    // Never reached the insert
    expect(supabase.inserts.lead_tags).toBeUndefined();
  });

  it("addTagToLead refuses a tag from another org", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: { id: "l1" }, error: null });
    supabase.queue("tags", { data: null, error: null }); // foreign tag

    await expect(addTagToLead("l1", "tag-foreign")).rejects.toThrow(
      /n[aã]o encontrada/i,
    );
    expect(supabase.inserts.lead_tags).toBeUndefined();
  });
});

// ============================================================
// CONVERSATIONS
// ============================================================
describe("conversations — cross-org access is blocked", () => {
  it("getConversations rejects when the orgId param does not match the caller", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase, ORG_A);

    const res = await getConversations(ORG_B);

    expect(res).toEqual({ data: null, error: "Org mismatch" });
    // Verify no query was made at all
    expect(supabase.filters.conversations).toBeUndefined();
  });

  it("getConversation(id) scopes by organization_id", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("conversations", {
      data: { id: "c1", organization_id: ORG_A },
      error: null,
    });

    await getConversation("c1");

    expectEveryEqOrgIsCaller(supabase.filters, "conversations");
  });

  it("assignConversation refuses a conversation from another org", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    // scoped SELECT returns nothing — conversation not in caller's org
    supabase.queue("conversations", { data: null, error: null });

    const res = await assignConversation("conv-foreign", "queue-1");

    expect(res.error).toBeTruthy();
    // Must never reach the UPDATE
    expect(supabase.updates.conversations).toBeUndefined();
  });

  it("markConversationAsRead scopes its UPDATE by organization_id", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("conversations", { data: null, error: null });

    await markConversationAsRead("c1");

    expectEveryEqOrgIsCaller(supabase.filters, "conversations");
  });
});

// ============================================================
// MESSAGES
// ============================================================
describe("messages — scoped by conversation_id AND organization_id", () => {
  it("getMessages filters by both conversation_id and organization_id", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("messages", { data: [], error: null });

    await getMessages("conv-1");

    const eqs = supabase.filters.messages?.eq ?? [];
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["conversation_id", "conv-1"],
        ["organization_id", ORG_A],
      ]),
    );
  });

  it("getMessages on a foreign conversation returns empty data (scope prevents leak)", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    // Same as if the RLS returned 0 rows for a conv that isn't in caller org
    supabase.queue("messages", { data: [], error: null });

    const res = await getMessages("conv-foreign");
    expect(res).toEqual({ data: [], error: null });
  });
});

// ============================================================
// TAGS
// ============================================================
describe("tags — INSERT carries org, UPDATE/DELETE scope by org", () => {
  it("createTag sets organization_id on the inserted row", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("tags", { data: { id: "t1" }, error: null });

    await createTag({ name: "VIP", color: "#fff" });

    const inserted = supabase.inserts.tags?.[0] as Record<string, unknown>;
    expect(inserted.organization_id).toBe(ORG_A);
  });

  it("updateTag scopes UPDATE by organization_id", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("tags", { data: null, error: null });

    await updateTag("t1", { name: "New" });

    expectEveryEqOrgIsCaller(supabase.filters, "tags");
  });

  it("deleteTag scopes both the lead_tags cleanup and the tags DELETE by org", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase, ORG_A, "admin");
    supabase.queue("lead_tags", { data: null, error: null });
    supabase.queue("tags", { data: null, error: null });

    await deleteTag("t1");

    expectEveryEqOrgIsCaller(supabase.filters, "lead_tags");
    expectEveryEqOrgIsCaller(supabase.filters, "tags");
  });

  it("removeTagFromLead scopes DELETE by organization_id", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("lead_tags", { data: null, error: null });

    await removeTagFromLead("l1", "t1");

    expectEveryEqOrgIsCaller(supabase.filters, "lead_tags");
  });

  it("getLeadTags scopes SELECT by organization_id", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("lead_tags", { data: [], error: null });

    await getLeadTags("l1");

    expectEveryEqOrgIsCaller(supabase.filters, "lead_tags");
  });
});

// ============================================================
// PIPELINE STAGES — documents a real known bug
// ============================================================
describe("pipeline_stages — known isolation gap in createStage", () => {
  // Current behavior: createStage writes organization_id = caller's org onto
  // pipeline_stages, but it never verifies that the supplied pipelineId
  // actually belongs to that org. An admin on ORG_A with the UUID of a
  // pipeline from ORG_B can produce a stage row with
  // organization_id=ORG_A AND pipeline_id=<foreign>, creating inconsistent
  // data and polluting the foreign pipeline's stage view (ignored by RLS
  // reads, but integrity is broken).
  //
  // When the fix lands (pre-validate pipeline ownership), change `.fails`
  // to a plain `it` below.
  it.fails(
    "[BUG] createStage SHOULD reject a pipelineId from another org — currently it writes it anyway",
    async () => {
      const supabase = createSupabaseMock();
      stubAuth(supabase, ORG_A, "admin");
      // If createStage were fixed, it would first SELECT the pipeline to
      // check organization_id; that select would return null (foreign
      // pipeline) and the action would throw before any INSERT.
      supabase.queue("pipelines", { data: null, error: null });
      supabase.queue("pipeline_stages", { data: null, error: null });

      await expect(
        createStage("pipe-foreign", "New Stage", 1),
      ).rejects.toThrow(/pipeline/i);

      expect(supabase.inserts.pipeline_stages).toBeUndefined();
    },
  );

  it("[CURRENT] createStage DOES stamp organization_id on the inserted stage (insufficient alone)", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase, ORG_A, "admin");
    supabase.queue("pipeline_stages", { data: { id: "s1" }, error: null });

    await createStage("pipe-any", "Won", 99);

    const inserted = supabase.inserts.pipeline_stages?.[0] as Record<
      string,
      unknown
    >;
    // Stamps org — prevents cross-org READS via RLS — but does NOT validate
    // the pipeline_id, which is the open gap.
    expect(inserted.organization_id).toBe(ORG_A);
    expect(inserted.pipeline_id).toBe("pipe-any");
  });
});
