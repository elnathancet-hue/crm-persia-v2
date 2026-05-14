import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// updateLead fires-and-forgets a dynamic import — stub it so the test doesn't
// pull the real supabase client or leak unhandled rejections.
vi.mock("@/lib/whatsapp/sync", () => ({
  syncLeadToUazapi: vi.fn(async () => {}),
}));

import { requireRole } from "@/lib/auth";
import {
  addTagToLead,
  createLead,
  deleteLead,
  getLead,
  getLeads,
  updateLead,
} from "@/actions/leads";

function stubAuth(supabase: MockSupabase) {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: "user-1" },
    orgId: "org-1",
    userId: "user-1",
    role: "agent",
  } as never);
}

function formDataOf(obj: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) fd.set(k, v);
  return fd;
}

describe("getLeads", () => {
  it("returns paginated leads and applies tag filter before pagination", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("lead_tags", {
      data: [{ lead_id: "l1" }],
      error: null,
    });
    supabase.queue("leads", {
      data: [
        { id: "l1", lead_tags: [{ tag_id: "t1", tags: { id: "t1", name: "VIP", color: "#f00" } }] },
      ],
      error: null,
      count: 1,
    });

    const result = await getLeads({ tags: ["t1"], page: 1, limit: 10 });
    expect(result.total).toBe(1);
    expect(result.leads.map((l) => l.id)).toEqual(["l1"]);
  });

  it("throws when the query errors", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: null, error: { message: "boom" } });
    await expect(getLeads()).rejects.toThrow(/boom/);
  });
});

describe("getLead", () => {
  it("merges lead, custom fields, and activities", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", {
      data: { id: "l1", organization_id: "org-1", name: "Ana" },
      error: null,
    });
    supabase.queue("lead_custom_field_values", {
      data: [{ id: "cf1", custom_field_id: "cf-id", value: "X" }],
      error: null,
    });
    supabase.queue("lead_activities", {
      data: [{ id: "a1", type: "note", description: "hi" }],
      error: null,
    });

    const { lead, activities } = await getLead("l1");
    expect(lead.id).toBe("l1");
    expect(lead.lead_custom_field_values).toHaveLength(1);
    expect(activities).toHaveLength(1);
  });
});

describe("createLead", () => {
  it("inserts a lead with defaults and required org_id when no existing lead shares the phone", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    // dedup lookup by phone — nothing exists
    supabase.queue("leads", { data: null, error: null });
    // insert returns the new row
    supabase.queue("leads", { data: { id: "new-lead" }, error: null });

    // PR-A LEADFIX: phone normalizado pra E.164. "11987654321" vira
    // "+5511987654321" antes do INSERT — padroniza dedup multi-canal.
    const data = await createLead(
      formDataOf({ name: "Ana", phone: "11987654321", email: "a@b.com" }),
    );
    expect(data).toEqual({ id: "new-lead" });
    expect(supabase.inserts.leads?.[0]).toMatchObject({
      organization_id: "org-1",
      name: "Ana",
      phone: "+5511987654321", // E.164 normalizado
      email: "a@b.com",
      source: "manual", // default
      status: "new", // default
      channel: "whatsapp", // default
    });
  });

  it("merges into the existing lead when one already matches the phone (dedup)", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    // dedup lookup finds a bare webhook-created lead (phone ja em E.164)
    supabase.queue("leads", {
      data: { id: "existing-1", name: null, email: null, phone: "+5511987654321" },
      error: null,
    });

    const data = await createLead(formDataOf({ name: "Ana", phone: "11987654321", email: "a@b.com" }));

    // Returns the merged row — keeps existing id
    expect((data as { id: string }).id).toBe("existing-1");
    // No new INSERT happened; only an UPDATE patch was applied
    expect(supabase.inserts.leads).toBeUndefined();
    const patch = (supabase.updates.leads?.[0] ?? {}) as Record<string, unknown>;
    expect(patch.name).toBe("Ana");
    expect(patch.email).toBe("a@b.com");
  });

  it("propagates DB errors", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: null, error: { message: "duplicate phone" } });
    await expect(createLead(formDataOf({ name: "X" }))).rejects.toThrow(/duplicate phone/);
  });
});

describe("updateLead", () => {
  it("builds patch only with the fields actually present", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: { id: "l1", status: "qualified" }, error: null });

    await updateLead("l1", formDataOf({ status: "qualified", source: "whatsapp" }));
    const patch = supabase.updates.leads?.[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ status: "qualified", source: "whatsapp" });
    // Fields not sent should NOT be in the patch
    expect(patch).not.toHaveProperty("email");
  });
});

describe("deleteLead", () => {
  it("scopes delete by org and returns ActionResult success", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: null, error: null });

    // Sprint 3b: shape de retorno migrado de { success: true } pra
    // ActionResult<{ success: true }> -> { data: { success: true } }.
    const res = await deleteLead("l1");
    expect(res).toEqual({ data: { success: true } });
    expect(supabase.deletes.leads).toBe(true);
  });

  it("returns ActionResult error on delete failure", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: null, error: { message: "FK violation" } });
    // Sprint 3b: nao lanca mais — retorna { error: ... }.
    const res = await deleteLead("l1");
    expect(res).toEqual({ error: expect.stringMatching(/FK violation/) });
  });
});

describe("addTagToLead", () => {
  it("swallows duplicate errors (23505) and returns void success", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: { id: "l1" }, error: null });
    supabase.queue("tags", { data: { id: "t1" }, error: null });
    supabase.queue("lead_tags", {
      data: null,
      error: { message: "duplicate", code: "23505" },
    });
    // Sprint 3d: action retorna ActionResult; sucesso silencioso = void/undefined.
    await expect(addTagToLead("l1", "t1")).resolves.toBeUndefined();
  });

  it("returns ActionResult error on non-duplicate errors", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("leads", { data: { id: "l1" }, error: null });
    supabase.queue("tags", { data: { id: "t1" }, error: null });
    supabase.queue("lead_tags", {
      data: null,
      error: { message: "something", code: "23502" },
    });
    // Sprint 3d: nao lanca mais — retorna { error }.
    const res = await addTagToLead("l1", "t1");
    expect(res).toEqual({ error: expect.stringMatching(/something/) });
  });
});
