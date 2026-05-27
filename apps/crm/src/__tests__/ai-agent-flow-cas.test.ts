// Backlog #3 Auditoria (mai/2026) — testes do CAS optimistic locking
// em saveFlow.
//
// Endereca rodada 9 #3 do POST_CODEX_AUDIT_AGENT_FLOW_353.md. Antes,
// saveFlow era last-write-wins silencioso — admins concorrentes
// editando o mesmo flow perdiam edicoes sem aviso. Agora CAS via
// expectedVersion + UPDATE WHERE version=X detecta conflitos e
// retorna shape discriminado pra UI mostrar modal de "recarregue".

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-request-id": "test" })),
}));

import { requireRole } from "@/lib/auth";
import { previewFlowImpact, saveFlow } from "@/actions/ai-agent/flow";

const ORG_ID = "org-1";
const CONFIG_ID = "cfg-1";

function stubAuth(supabase: MockSupabase) {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: "user-1" },
    orgId: ORG_ID,
    userId: "user-1",
    role: "admin",
  } as never);
}

const baseConfig = {
  nodes: [
    {
      id: "entry-1",
      type: "entry" as const,
      position: { x: 0, y: 0 },
      data: { label: "Inicio", trigger: "conversation_started" as const },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  enabled_tools: [],
};

describe("Backlog #3: saveFlow CAS optimistic locking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sem expectedVersion (backwards compat) sucede com last-write-wins", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    // agent_configs IDOR check
    supabase.queue("agent_configs", { data: { id: CONFIG_ID }, error: null });
    // agent_flows existing
    supabase.queue("agent_flows", {
      data: { id: "flow-1", version: 5 },
      error: null,
    });
    // UPDATE retorna count=1 (sucesso)
    supabase.queue("agent_flows", { data: null, error: null, count: 1 });

    const result = await saveFlow(CONFIG_ID, baseConfig);

    expect(result).toEqual({ ok: true, version: 6 });
  });

  it("com expectedVersion BATENDO sucede + incrementa version", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", { data: { id: CONFIG_ID }, error: null });
    supabase.queue("agent_flows", {
      data: { id: "flow-1", version: 7 },
      error: null,
    });
    supabase.queue("agent_flows", { data: null, error: null, count: 1 });

    const result = await saveFlow(CONFIG_ID, baseConfig, 7);

    expect(result).toEqual({ ok: true, version: 8 });
  });

  it("com expectedVersion STALE retorna conflict + current_version do server", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", { data: { id: CONFIG_ID }, error: null });
    // Server tem version=9, mas UI tinha carregado version=5 (outro
    // admin salvou 4 vezes enquanto este editava)
    supabase.queue("agent_flows", {
      data: { id: "flow-1", version: 9 },
      error: null,
    });

    const result = await saveFlow(CONFIG_ID, baseConfig, 5);

    expect(result).toEqual({
      ok: false,
      conflict: true,
      expected_version: 5,
      current_version: 9,
    });
    // NAO deve fazer UPDATE
    expect(supabase.updates.agent_flows).toBeUndefined();
  });

  it("CAS race window (count=0 apos UPDATE) retorna conflict com versao real", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", { data: { id: CONFIG_ID }, error: null });
    // SELECT mostra version=3
    supabase.queue("agent_flows", {
      data: { id: "flow-1", version: 3 },
      error: null,
    });
    // UPDATE retorna count=0 — outro admin venceu a race entre SELECT e UPDATE
    supabase.queue("agent_flows", { data: null, error: null, count: 0 });
    // refetch mostra version real 5 (outro admin atualizou +2)
    supabase.queue("agent_flows", { data: { version: 5 }, error: null });

    const result = await saveFlow(CONFIG_ID, baseConfig, 3);

    expect(result).toEqual({
      ok: false,
      conflict: true,
      expected_version: 3,
      current_version: 5,
    });
  });

  it("primeira save (sem flow existente) INSERT com version=1, sem CAS", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", { data: { id: CONFIG_ID }, error: null });
    // Nenhum flow existente
    supabase.queue("agent_flows", { data: null, error: null });
    // INSERT sucede
    supabase.queue("agent_flows", { data: null, error: null });

    const result = await saveFlow(CONFIG_ID, baseConfig);

    expect(result).toEqual({ ok: true, version: 1 });
  });

  it("IDOR check: config inexistente lanca erro", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    // agent_configs query retorna null (config nao pertence a org)
    supabase.queue("agent_configs", { data: null, error: null });

    await expect(saveFlow(CONFIG_ID, baseConfig)).rejects.toThrow(
      /Agente n[aã]o encontrado/i,
    );
  });
});

describe("Backlog #4: previewFlowImpact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const configEntryOnly = {
    nodes: [
      {
        id: "entry-1",
        type: "entry" as const,
        position: { x: 0, y: 0 },
        data: { label: "Inicio", trigger: "conversation_started" as const },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    enabled_tools: [],
  };

  it("zero impacto quando nao ha convs vivas", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", { data: { id: CONFIG_ID }, error: null });
    supabase.queue("agent_conversations", { data: [], error: null });

    const result = await previewFlowImpact(CONFIG_ID, configEntryOnly);

    expect(result).toEqual({
      affected_conversations: 0,
      at_risk_node_ids: [],
      total_live_conversations: 0,
    });
  });

  it("zero impacto quando todas convs estao em nodes que continuam existindo", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", { data: { id: CONFIG_ID }, error: null });
    // 3 convs todas paradas em "entry-1" (que existe no config novo)
    supabase.queue("agent_conversations", {
      data: [
        { current_node_id: "entry-1" },
        { current_node_id: "entry-1" },
        { current_node_id: "entry-1" },
      ],
      error: null,
    });

    const result = await previewFlowImpact(CONFIG_ID, configEntryOnly);

    expect(result).toEqual({
      affected_conversations: 0,
      at_risk_node_ids: [],
      total_live_conversations: 3,
    });
  });

  it("contabiliza convs afetadas + deduplica node_ids em risco", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", { data: { id: CONFIG_ID }, error: null });
    // Mix: 2 convs em "old-node-a" (removido), 1 em "old-node-b" (removido),
    // 2 em "entry-1" (mantido). Total 5 convs, 3 afetadas.
    supabase.queue("agent_conversations", {
      data: [
        { current_node_id: "old-node-a" },
        { current_node_id: "old-node-a" },
        { current_node_id: "old-node-b" },
        { current_node_id: "entry-1" },
        { current_node_id: "entry-1" },
      ],
      error: null,
    });

    const result = await previewFlowImpact(CONFIG_ID, configEntryOnly);

    expect(result.affected_conversations).toBe(3);
    expect(result.total_live_conversations).toBe(5);
    // at_risk_node_ids deduplicado (2 convs em old-node-a contam 1x na lista)
    expect(result.at_risk_node_ids.sort()).toEqual(["old-node-a", "old-node-b"]);
  });

  it("IDOR check: config inexistente lanca erro", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", { data: null, error: null });

    await expect(previewFlowImpact(CONFIG_ID, configEntryOnly)).rejects.toThrow(
      /Agente n[aã]o encontrado/i,
    );
  });
});
