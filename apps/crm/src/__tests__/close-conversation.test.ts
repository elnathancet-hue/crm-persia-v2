// Tests da action closeConversation (mai/2026).
//
// Cobre o comportamento "fechar e reativar IA" disparado pelo botão
// "Fechar conversa" no kebab do chat header:
//   1. UPDATE conversations.status = 'closed' + closed_at = now
//   2. CLEAR agent_conversations.human_handoff_at = null (IA reativa)
//   3. INSERT lead_activities com type='conversation_closed'
//
// Próxima msg do lead → webhook cria conversation NOVA (status 'closed'
// não está em OPEN_CONVERSATION_STATUSES) → novo agent_conversations →
// IA começa do entry node, fresh.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/cache/lead-revalidation", () => ({
  revalidateLeadAndChatCaches: vi.fn(),
}));
// Sync UAZAPI é fire-and-forget (dynamic import). Mock pra não tentar carregar.
vi.mock("@/lib/whatsapp/sync", () => ({
  enableChatbotForLead: vi.fn(),
  syncTicketStatusToUazapi: vi.fn(),
}));

import { requireRole } from "@/lib/auth";
import { closeConversation } from "@/actions/conversations";

const ORG_ID = "org-1";
const USER_ID = "user-99";
const CONV_ID = "conv-1";
const LEAD_ID = "lead-1";

function stubAuth(supabase: MockSupabase) {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: USER_ID },
    orgId: ORG_ID,
    userId: USER_ID,
    role: "agent",
  } as never);
}

describe("closeConversation (mai/2026)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("encerra conversa: UPDATE status='closed' + clear human_handoff_at + log activity", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);

    // 1. SELECT da conversation (lookup do lead_id + phone)
    supabase.queue("conversations", {
      data: {
        organization_id: ORG_ID,
        lead_id: LEAD_ID,
        leads: { phone: "5511999999999" },
      },
      error: null,
    });
    // 2. UPDATE conversations.status='closed'
    supabase.queue("conversations", {
      data: { id: CONV_ID, status: "closed" },
      error: null,
    });
    // 3. UPDATE agent_conversations.human_handoff_at = null (via helper)
    //    Helper faz UPDATE com .select() — mock retorna array vazio
    //    (org sem native agent) pra simular no-op gracioso.
    supabase.queue("agent_conversations", { data: [], error: null });
    // 4. INSERT em lead_activities
    supabase.queue("lead_activities", { data: null, error: null });

    const result = await closeConversation(CONV_ID);

    expect(result.error).toBeNull();
    expect(result.data).toBeTruthy();

    // 1) UPDATE em conversations com status closed
    const convUpdates = supabase.updates.conversations as Array<Record<string, unknown>>;
    expect(convUpdates[0]).toMatchObject({
      status: "closed",
    });
    expect(convUpdates[0]?.closed_at).toBeTruthy();

    // 2) UPDATE em agent_conversations com human_handoff_at=null (clear)
    const agentConvUpdates = supabase.updates.agent_conversations as
      | Array<Record<string, unknown>>
      | undefined;
    expect(agentConvUpdates?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(agentConvUpdates![0]).toMatchObject({
      human_handoff_at: null,
      human_handoff_reason: null,
    });

    // 3) INSERT em lead_activities
    const activityInserts = supabase.inserts.lead_activities as
      | Array<Record<string, unknown>>
      | undefined;
    expect(activityInserts).toHaveLength(1);
    expect(activityInserts![0]).toMatchObject({
      organization_id: ORG_ID,
      lead_id: LEAD_ID,
      performed_by: USER_ID,
      type: "conversation_closed",
    });
  });

  it("retorna erro quando conversa nao encontrada (multi-tenant guard)", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);

    // SELECT retorna null (conv não pertence ao org ou não existe)
    supabase.queue("conversations", { data: null, error: null });

    const result = await closeConversation(CONV_ID);

    expect(result.error).toBe("Conversa nao encontrada");
    expect(result.data).toBeNull();

    // Nada foi mutado
    expect(supabase.updates.conversations).toBeUndefined();
    expect(supabase.inserts.lead_activities).toBeUndefined();
  });

  it("activity log falhando NAO bloqueia o close (best-effort)", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);

    supabase.queue("conversations", {
      data: { organization_id: ORG_ID, lead_id: LEAD_ID, leads: null },
      error: null,
    });
    supabase.queue("conversations", {
      data: { id: CONV_ID, status: "closed" },
      error: null,
    });
    supabase.queue("agent_conversations", { data: [], error: null });
    // INSERT activity falha (RLS, schema mismatch, etc)
    supabase.queue("lead_activities", {
      data: null,
      error: { message: "row-level security policy" },
    });

    const result = await closeConversation(CONV_ID);

    // Close em si succeeded; só o log que falhou em background
    expect(result.error).toBeNull();
    expect(result.data).toBeTruthy();
  });
});
