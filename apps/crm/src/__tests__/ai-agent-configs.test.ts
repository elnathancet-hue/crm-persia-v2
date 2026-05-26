import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireRole } from "@/lib/auth";
import { createAgent } from "@/actions/ai-agent/configs";

const ORG_ID = "org-configs";

function stubAuth(supabase: MockSupabase) {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: "user-1" },
    orgId: ORG_ID,
    userId: "user-1",
    role: "admin",
  } as never);
}

function makeCreateInput(overrides: Partial<Parameters<typeof createAgent>[0]> = {}) {
  return {
    name: "Agente comercial",
    scope_type: "global" as const,
    model: "gpt-5-mini",
    system_prompt: "Atenda leads com clareza.",
    ...overrides,
  };
}

describe("ai-agent config actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grava CRM inicial ao criar agente quando new_lead_stage_id pertence a org", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);

    supabase.queue("pipeline_stages", {
      data: { id: "stage-initial" },
      error: null,
    });
    supabase.queue("agent_configs", { data: null, error: null });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-created",
        organization_id: ORG_ID,
        name: "Agente comercial",
        system_prompt: "Atenda leads com clareza.",
        new_lead_stage_id: "stage-initial",
      },
      error: null,
    });
    supabase.queue("agent_tools", { data: { id: "tool-stop" }, error: null });

    await createAgent(makeCreateInput({ new_lead_stage_id: "stage-initial" }));

    expect(supabase.inserts.agent_configs?.[0]).toMatchObject({
      organization_id: ORG_ID,
      new_lead_stage_id: "stage-initial",
      is_primary: true,
    });
    expect(supabase.filters.pipeline_stages.eq).toEqual(
      expect.arrayContaining([
        ["organization_id", ORG_ID],
        ["id", "stage-initial"],
      ]),
    );
  });

  it("rejeita CRM inicial inexistente antes de criar o agente", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);

    supabase.queue("pipeline_stages", { data: null, error: null });

    await expect(
      createAgent(makeCreateInput({ new_lead_stage_id: "stage-missing" })),
    ).rejects.toThrow("Etapa inicial do CRM nao encontrada");

    expect(supabase.inserts.agent_configs).toBeUndefined();
    expect(supabase.inserts.agent_tools).toBeUndefined();
  });

  it("nao marca novo agente como principal quando a org ja tem agente", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);

    supabase.queue("agent_configs", {
      data: { id: "agent-existing" },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-created",
        organization_id: ORG_ID,
        name: "Agente comercial",
        system_prompt: "Atenda leads com clareza.",
        is_primary: false,
      },
      error: null,
    });
    supabase.queue("agent_tools", { data: { id: "tool-stop" }, error: null });

    await createAgent(makeCreateInput());

    expect(supabase.inserts.agent_configs?.[0]).toMatchObject({
      organization_id: ORG_ID,
      is_primary: false,
    });
  });
});
