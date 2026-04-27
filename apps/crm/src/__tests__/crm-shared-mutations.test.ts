import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

import {
  addTagToLead,
  createLead,
  createTag,
  deleteLead,
  deleteTag,
  removeTagFromLead,
  updateLead,
  updateTag,
} from "@persia/shared/crm";

const ORG_A = "org-a";

function ctx(supabase: MockSupabase, onLeadChanged?: (id: string) => void) {
  return { db: supabase as never, orgId: ORG_A, onLeadChanged };
}

describe("@persia/shared/crm — mutations compartilhadas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // createLead
  // ============================================================================

  it("createLead insere um lead novo quando nao ha phone", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { id: "lead-new", organization_id: ORG_A, name: "Carlos", phone: null, email: null, source: "manual", status: "new", channel: "whatsapp" },
      error: null,
    });

    const onLeadChanged = vi.fn();
    const lead = await createLead(ctx(supabase, onLeadChanged), { name: "Carlos" });

    expect(lead.id).toBe("lead-new");
    expect(onLeadChanged).toHaveBeenCalledWith("lead-new");
    expect(supabase.inserts.leads?.[0]).toMatchObject({
      organization_id: ORG_A,
      name: "Carlos",
      phone: null,
      source: "manual",
      status: "new",
      channel: "whatsapp",
    });
  });

  it("createLead com phone ja existente faz merge em vez de duplicar", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: {
        id: "lead-existing",
        organization_id: ORG_A,
        name: null,
        phone: "+5511999999999",
        email: null,
      },
      error: null,
    });
    supabase.queue("leads", { data: null, error: null }); // update result

    const onLeadChanged = vi.fn();
    const lead = await createLead(
      ctx(supabase, onLeadChanged),
      { name: "Carlos Silva", phone: "+5511999999999", email: "carlos@x.com" },
    );

    expect(lead.id).toBe("lead-existing");
    expect(supabase.updates.leads?.[0]).toMatchObject({
      name: "Carlos Silva",
      email: "carlos@x.com",
    });
    expect(supabase.inserts.leads).toBeUndefined();
    expect(onLeadChanged).toHaveBeenCalledWith("lead-existing");
  });

  it("createLead com phone existente NAO sobrescreve campos preenchidos", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: {
        id: "lead-existing",
        name: "Nome Antigo",
        phone: "+5511999999999",
        email: "antigo@x.com",
      },
      error: null,
    });
    supabase.queue("leads", { data: null, error: null });

    await createLead(
      ctx(supabase),
      { name: "Nome Novo", phone: "+5511999999999", email: "novo@x.com" },
    );

    const update = supabase.updates.leads?.[0] as Record<string, unknown>;
    // Campos existentes nao sao sobrescritos.
    expect(update?.name).toBeUndefined();
    expect(update?.email).toBeUndefined();
    // updated_at sempre vem.
    expect(update?.updated_at).toBeDefined();
  });

  it("createLead throw em erro de DB no insert", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: null, error: { message: "constraint violation" } });

    await expect(createLead(ctx(supabase), { name: "X" })).rejects.toThrow("constraint violation");
  });

  // ============================================================================
  // updateLead
  // ============================================================================

  it("updateLead atualiza so os campos passados", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { id: "lead-1", name: "Novo Nome", organization_id: ORG_A },
      error: null,
    });

    const onLeadChanged = vi.fn();
    await updateLead(ctx(supabase, onLeadChanged), "lead-1", { name: "Novo Nome" });

    const update = supabase.updates.leads?.[0] as Record<string, unknown>;
    expect(update.name).toBe("Novo Nome");
    expect(update.phone).toBeUndefined();
    expect(update.updated_at).toBeDefined();
    expect(onLeadChanged).toHaveBeenCalledWith("lead-1");
  });

  it("updateLead throw quando lead nao pertence ao org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: null, error: null });

    await expect(
      updateLead(ctx(supabase), "lead-x", { name: "X" }),
    ).rejects.toThrow("Lead nao encontrado nesta organizacao");
  });

  // ============================================================================
  // deleteLead
  // ============================================================================

  it("deleteLead remove o lead com org-scoping", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: null, error: null });

    await deleteLead(ctx(supabase), "lead-1");

    expect(supabase.deletes.leads).toBe(true);
    const eqs = supabase.filters.leads?.eq ?? [];
    expect(eqs.some(([col, val]) => col === "id" && val === "lead-1")).toBe(true);
    expect(eqs.some(([col, val]) => col === "organization_id" && val === ORG_A)).toBe(true);
  });

  it("deleteLead throw em erro de DB", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: null, error: { message: "fk violation" } });

    await expect(deleteLead(ctx(supabase), "lead-1")).rejects.toThrow("fk violation");
  });

  // ============================================================================
  // createTag
  // ============================================================================

  it("createTag insere com cor default quando nao informada", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", {
      data: { id: "tag-new", organization_id: ORG_A, name: "vip", color: "#6366f1", created_at: "2026-01-01" },
      error: null,
    });

    const tag = await createTag(ctx(supabase), { name: "vip" });

    expect(tag.id).toBe("tag-new");
    expect(supabase.inserts.tags?.[0]).toMatchObject({
      organization_id: ORG_A,
      name: "vip",
      color: "#6366f1",
    });
  });

  it("createTag respeita cor customizada", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", {
      data: { id: "tag-new", name: "vip", color: "#ff0000", organization_id: ORG_A, created_at: "2026-01-01" },
      error: null,
    });

    await createTag(ctx(supabase), { name: "vip", color: "#ff0000" });

    expect(supabase.inserts.tags?.[0]).toMatchObject({ color: "#ff0000" });
  });

  // ============================================================================
  // updateTag
  // ============================================================================

  it("updateTag valida org-scoping antes de atualizar", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: null, error: null }); // tag lookup vazio

    await expect(
      updateTag(ctx(supabase), "tag-x", { name: "novo" }),
    ).rejects.toThrow("Tag nao encontrada nesta organizacao");
    expect(supabase.updates.tags).toBeUndefined();
  });

  it("updateTag noop quando nenhum campo informado", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: { id: "tag-1" }, error: null });

    await updateTag(ctx(supabase), "tag-1", {});

    expect(supabase.updates.tags).toBeUndefined();
  });

  // ============================================================================
  // deleteTag
  // ============================================================================

  it("deleteTag remove lead_tags antes da tag", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: { id: "tag-1" }, error: null }); // lookup
    supabase.queue("lead_tags", { data: null, error: null }); // delete lead_tags
    supabase.queue("tags", { data: null, error: null }); // delete tag

    await deleteTag(ctx(supabase), "tag-1");

    expect(supabase.deletes.lead_tags).toBe(true);
    expect(supabase.deletes.tags).toBe(true);
  });

  it("deleteTag throw quando tag nao pertence ao org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: null, error: null });

    await expect(deleteTag(ctx(supabase), "tag-x")).rejects.toThrow("Tag nao encontrada");
  });

  // ============================================================================
  // addTagToLead
  // ============================================================================

  it("addTagToLead valida que lead e tag pertencem ao org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: { id: "lead-1" }, error: null });
    supabase.queue("tags", { data: { id: "tag-1" }, error: null });
    supabase.queue("lead_tags", { data: null, error: null });

    const onLeadChanged = vi.fn();
    await addTagToLead(ctx(supabase, onLeadChanged), "lead-1", "tag-1");

    expect(supabase.inserts.lead_tags?.[0]).toMatchObject({
      lead_id: "lead-1",
      tag_id: "tag-1",
      organization_id: ORG_A,
    });
    expect(onLeadChanged).toHaveBeenCalledWith("lead-1");
  });

  it("addTagToLead throw quando lead nao pertence ao org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: null, error: null });

    await expect(
      addTagToLead(ctx(supabase), "lead-x", "tag-1"),
    ).rejects.toThrow("Lead nao encontrado nesta organizacao");
  });

  it("addTagToLead idempotente (ignora unique violation 23505)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: { id: "lead-1" }, error: null });
    supabase.queue("tags", { data: { id: "tag-1" }, error: null });
    supabase.queue("lead_tags", { data: null, error: { message: "duplicate", code: "23505" } });

    const onLeadChanged = vi.fn();
    // Nao deve throw — operacao eh idempotente.
    await expect(
      addTagToLead(ctx(supabase, onLeadChanged), "lead-1", "tag-1"),
    ).resolves.toBeUndefined();
    // Tambem nao dispara onLeadChanged se nada mudou.
    expect(onLeadChanged).not.toHaveBeenCalled();
  });

  // ============================================================================
  // removeTagFromLead
  // ============================================================================

  it("removeTagFromLead deleta com org-scoping e dispara onLeadChanged", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("lead_tags", { data: null, error: null });

    const onLeadChanged = vi.fn();
    await removeTagFromLead(ctx(supabase, onLeadChanged), "lead-1", "tag-1");

    expect(supabase.deletes.lead_tags).toBe(true);
    expect(onLeadChanged).toHaveBeenCalledWith("lead-1");
  });

  it("removeTagFromLead throw em erro de DB (mas nao em ausencia de associacao)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("lead_tags", { data: null, error: { message: "db down" } });

    await expect(
      removeTagFromLead(ctx(supabase), "lead-1", "tag-1"),
    ).rejects.toThrow("db down");
  });
});
