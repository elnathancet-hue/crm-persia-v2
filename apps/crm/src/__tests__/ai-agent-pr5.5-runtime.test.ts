import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
  getRequestId: vi.fn(() => "req-test"),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const featureFlagMock = vi.hoisted(() => ({
  isNativeAgentEnabled: vi.fn(),
}));

const contextMock = vi.hoisted(() => ({
  loadActiveAgentConfig: vi.fn(),
  resolveAgentContext: vi.fn(),
}));

const debounceMock = vi.hoisted(() => ({
  enqueueDebounced: vi.fn(),
  flushReadyConversations: vi.fn(),
}));

const processIncomingMessageMock = vi.hoisted(() => ({
  processIncomingMessage: vi.fn(),
}));

const createProviderMock = vi.hoisted(() => ({
  createProvider: vi.fn(),
}));

const enqueueOutcomeMock = vi.hoisted(() => ({
  tryEnqueueForNativeAgent: vi.fn(),
}));

const createClientMock = vi.hoisted(() => vi.fn());
const validateSignatureMock = vi.hoisted(() => vi.fn());
const getMatchMethodMock = vi.hoisted(() => vi.fn());
const ownerFallbackMock = vi.hoisted(() => vi.fn());
const ownerPhoneMock = vi.hoisted(() => vi.fn());
const webhookTokenMock = vi.hoisted(() => vi.fn());
const logDiagnosticsMock = vi.hoisted(() => vi.fn());
const executeDebouncedBatchMock = vi.hoisted(() => vi.fn());
const createAdminClientMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/ai-agent/feature-flag", () => featureFlagMock);
vi.mock("@/lib/ai-agent/context", () => contextMock);
vi.mock("@/lib/ai-agent/debounce", () => debounceMock);
vi.mock("@/lib/whatsapp/incoming-pipeline", () => processIncomingMessageMock);
vi.mock("@/lib/whatsapp/providers", () => createProviderMock);
vi.mock("@/lib/ai-agent/executor", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai-agent/executor")>("@/lib/ai-agent/executor");
  return {
    ...actual,
    tryEnqueueForNativeAgent: enqueueOutcomeMock.tryEnqueueForNativeAgent,
    executeDebouncedBatch: executeDebouncedBatchMock,
  };
});
vi.mock("@/lib/whatsapp/uazapi-webhook-verifier", () => ({
  validateUazapiWebhookSignature: validateSignatureMock,
}));
vi.mock("@/lib/whatsapp/uazapi-webhook-diagnostics", () => ({
  extractUazapiOwnerPhone: ownerPhoneMock,
  extractUazapiWebhookToken: webhookTokenMock,
  getUazapiConnectionMatchMethod: getMatchMethodMock,
  isUazapiOwnerPhoneFallbackAllowed: ownerFallbackMock,
  logUazapiWebhookDiagnostics: logDiagnosticsMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { POST as debounceFlushPost } from "@/app/api/ai-agent/debounce-flush/route";
import { POST as uazapiWebhookPost } from "@/app/api/whatsapp/webhook/route";

describe("ai-agent PR5.5 runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PERSIA_DEBOUNCE_FLUSH_SECRET = "flush-secret-123";
    featureFlagMock.isNativeAgentEnabled.mockResolvedValue(true);
    contextMock.loadActiveAgentConfig.mockResolvedValue({
      id: "config-a",
      organization_id: "org-a",
      debounce_window_ms: 3000,
      status: "active",
    });
    contextMock.resolveAgentContext.mockResolvedValue({
      config: { id: "config-a", organization_id: "org-a", debounce_window_ms: 3000 },
      stage: { id: "stage-a" },
      agentConversation: { id: "agent-conv-a" },
      tools: [],
      crm: {
        leadId: "lead-a",
        crmConversationId: "crm-conv-a",
        inboundMessageId: "inbound-a",
      },
    });
    debounceMock.enqueueDebounced.mockResolvedValue(undefined);
  });

  it("tryEnqueueForNativeAgent enqueues and returns debounced outcome", async () => {
    const { tryEnqueueForNativeAgent } = await vi.importActual<typeof import("@/lib/ai-agent/executor")>(
      "@/lib/ai-agent/executor",
    );

    const result = await tryEnqueueForNativeAgent({
      supabase: createSupabaseMock() as never,
      orgId: "org-a",
      provider: {} as never,
      requestId: "req-a",
      msg: {
        messageId: "wamid.a",
        phone: "5511999999999",
        pushName: "Ana",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: 1_700_000_000_000,
      },
    });

    expect(result).toEqual({
      handled: true,
      response: {
        ok: true,
        skipped: "debounced",
        enqueued: true,
        handledBy: "ai_native",
        leadId: "lead-a",
        conversationId: "crm-conv-a",
      },
    });
    expect(debounceMock.enqueueDebounced).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-a",
        agentConversationId: "agent-conv-a",
        debounceWindowMs: 3000,
        inboundMessageId: "inbound-a",
      }),
    );
  });

  it("tryEnqueueForNativeAgent falls through when enqueue fails", async () => {
    debounceMock.enqueueDebounced.mockRejectedValue(new Error("queue down"));
    const { tryEnqueueForNativeAgent } = await vi.importActual<typeof import("@/lib/ai-agent/executor")>(
      "@/lib/ai-agent/executor",
    );

    const result = await tryEnqueueForNativeAgent({
      supabase: createSupabaseMock() as never,
      orgId: "org-a",
      provider: {} as never,
      msg: {
        messageId: "wamid.a",
        phone: "5511999999999",
        pushName: "Ana",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result).toEqual({
      handled: false,
      reason: "exception",
    });
  });

  it("flushReadyConversations groups a burst and creates one run", async () => {
    const { flushReadyConversations } = await vi.importActual<typeof import("@/lib/ai-agent/debounce")>(
      "@/lib/ai-agent/debounce",
    );
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: [
        {
          id: "agent-conv-a",
          organization_id: "org-a",
          next_flush_at: "2026-04-23T12:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("rpc:claim_agent_conversation_flush", {
      data: true,
      error: null,
    });
    supabase.queue("pending_messages", {
      data: [
        {
          id: "pm-1",
          organization_id: "org-a",
          agent_conversation_id: "agent-conv-a",
          text: "oi",
          message_type: "text",
          media_ref: null,
          inbound_message_id: "m-1",
          received_at: "2026-04-23T12:00:00.000Z",
          flushed_at: null,
          created_at: "2026-04-23T12:00:00.000Z",
        },
        {
          id: "pm-2",
          organization_id: "org-a",
          agent_conversation_id: "agent-conv-a",
          text: "tudo bem?",
          message_type: "text",
          media_ref: null,
          inbound_message_id: "m-2",
          received_at: "2026-04-23T12:00:01.000Z",
          flushed_at: null,
          created_at: "2026-04-23T12:00:01.000Z",
        },
        {
          id: "pm-3",
          organization_id: "org-a",
          agent_conversation_id: "agent-conv-a",
          text: "quero saber o preco",
          message_type: "text",
          media_ref: null,
          inbound_message_id: "m-3",
          received_at: "2026-04-23T12:00:02.000Z",
          flushed_at: null,
          created_at: "2026-04-23T12:00:02.000Z",
        },
        {
          id: "pm-4",
          organization_id: "org-a",
          agent_conversation_id: "agent-conv-a",
          text: "do plano",
          message_type: "text",
          media_ref: null,
          inbound_message_id: "m-4",
          received_at: "2026-04-23T12:00:03.000Z",
          flushed_at: null,
          created_at: "2026-04-23T12:00:03.000Z",
        },
        {
          id: "pm-5",
          organization_id: "org-a",
          agent_conversation_id: "agent-conv-a",
          text: "premium",
          message_type: "text",
          media_ref: null,
          inbound_message_id: "m-5",
          received_at: "2026-04-23T12:00:04.000Z",
          flushed_at: null,
          created_at: "2026-04-23T12:00:04.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("rpc:complete_agent_conversation_flush", {
      data: false,
      error: null,
    });
    executeDebouncedBatchMock.mockResolvedValue({
      runId: "run-a",
      status: "succeeded",
    });

    const result = await flushReadyConversations({
      db: supabase as never,
      now: new Date("2026-04-23T12:00:10.000Z"),
    });

    expect(result.flushed_conversations).toBe(1);
    expect(result.runs_created).toBe(1);
    expect(result.errors).toBe(0);
    expect(executeDebouncedBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-a",
        batch: expect.objectContaining({
          pending_message_ids: ["pm-1", "pm-2", "pm-3", "pm-4", "pm-5"],
          concatenated_text: "oi\ntudo bem?\nquero saber o preco\ndo plano\npremium",
          latest_inbound_message_id: "m-5",
        }),
      }),
    );
    expect(supabase.rpcCalls.find((call) => call.fn === "complete_agent_conversation_flush")?.args)
      .toMatchObject({
        p_pending_message_ids: ["pm-1", "pm-2", "pm-3", "pm-4", "pm-5"],
      });
  });

  it("flushReadyConversations skips a conversation another worker already claimed", async () => {
    const { flushReadyConversations } = await vi.importActual<typeof import("@/lib/ai-agent/debounce")>(
      "@/lib/ai-agent/debounce",
    );
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: [
        {
          id: "agent-conv-a",
          organization_id: "org-a",
          next_flush_at: "2026-04-23T12:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("rpc:claim_agent_conversation_flush", {
      data: false,
      error: null,
    });

    const result = await flushReadyConversations({
      db: supabase as never,
      now: new Date("2026-04-23T12:00:10.000Z"),
    });

    expect(result.flushed_conversations).toBe(0);
    expect(result.details?.[0]).toMatchObject({
      agent_conversation_id: "agent-conv-a",
      status: "skipped",
    });
    expect(executeDebouncedBatchMock).not.toHaveBeenCalled();
  });

  it("flushReadyConversations logs an error for one conversation and continues with the next", async () => {
    const { flushReadyConversations } = await vi.importActual<typeof import("@/lib/ai-agent/debounce")>(
      "@/lib/ai-agent/debounce",
    );
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: [
        {
          id: "agent-conv-a",
          organization_id: "org-a",
          next_flush_at: "2026-04-23T12:00:00.000Z",
        },
        {
          id: "agent-conv-b",
          organization_id: "org-b",
          next_flush_at: "2026-04-23T12:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("rpc:claim_agent_conversation_flush", { data: true, error: null });
    supabase.queue("rpc:claim_agent_conversation_flush", { data: true, error: null });
    supabase.queue("pending_messages", {
      data: [
        {
          id: "pm-a",
          organization_id: "org-a",
          agent_conversation_id: "agent-conv-a",
          text: "oi",
          message_type: "text",
          media_ref: null,
          inbound_message_id: "m-a",
          received_at: "2026-04-23T12:00:00.000Z",
          flushed_at: null,
          created_at: "2026-04-23T12:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("pending_messages", {
      data: [
        {
          id: "pm-b",
          organization_id: "org-b",
          agent_conversation_id: "agent-conv-b",
          text: "olá",
          message_type: "text",
          media_ref: null,
          inbound_message_id: "m-b",
          received_at: "2026-04-23T12:00:00.000Z",
          flushed_at: null,
          created_at: "2026-04-23T12:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("rpc:release_agent_conversation_flush", { data: false, error: null });
    supabase.queue("rpc:complete_agent_conversation_flush", { data: false, error: null });
    executeDebouncedBatchMock
      .mockRejectedValueOnce(new Error("openai down"))
      .mockResolvedValueOnce({ runId: "run-b", status: "succeeded" });

    const result = await flushReadyConversations({
      db: supabase as never,
      now: new Date("2026-04-23T12:00:10.000Z"),
    });

    expect(result.errors).toBe(1);
    expect(result.flushed_conversations).toBe(1);
    expect(result.runs_created).toBe(1);
    expect(result.details?.map((detail) => detail.status)).toEqual(["failed", "succeeded"]);
  });

  it("debounce flush endpoint rejects bad secret", async () => {
    const request = new NextRequest("https://crm.funilpersia.top/api/ai-agent/debounce-flush", {
      method: "POST",
      headers: { "X-Persia-Cron-Secret": "wrong-secret" },
    });

    const response = await debounceFlushPost(request);

    expect(response.status).toBe(401);
  });

  it("debounce flush endpoint fails closed when secret env is missing", async () => {
    delete process.env.PERSIA_DEBOUNCE_FLUSH_SECRET;
    const request = new NextRequest("https://crm.funilpersia.top/api/ai-agent/debounce-flush", {
      method: "POST",
      headers: { "X-Persia-Cron-Secret": "flush-secret-123" },
    });

    const response = await debounceFlushPost(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ ok: false, error: "flush_secret_missing" });
  });

  it("debounce flush endpoint returns the batch result on success", async () => {
    debounceMock.flushReadyConversations.mockResolvedValue({
      flushed_conversations: 2,
      runs_created: 2,
      errors: 0,
      details: [],
    });
    createAdminClientMock.mockReturnValue(createSupabaseMock());

    const request = new NextRequest("https://crm.funilpersia.top/api/ai-agent/debounce-flush", {
      method: "POST",
      headers: { "X-Persia-Cron-Secret": "flush-secret-123" },
    });

    const response = await debounceFlushPost(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      flushed_conversations: 2,
      runs_created: 2,
      errors: 0,
    });
  });

  it("UAZAPI webhook returns debounced response when native enqueue handles the message", async () => {
    const supabase = createSupabaseMock();
    createClientMock.mockReturnValue(supabase);
    validateSignatureMock.mockReturnValue({
      configured: false,
      mode: "off",
      valid: true,
      accepted: true,
      present: false,
      headerName: "x-signature",
    });
    ownerPhoneMock.mockReturnValue("5511999999999");
    webhookTokenMock.mockReturnValue("instance-token");
    ownerFallbackMock.mockReturnValue(true);
    getMatchMethodMock.mockReturnValue("token");
    supabase.queue("whatsapp_connections", {
      data: [
        {
          organization_id: "org-a",
          provider: "uazapi",
          status: "connected",
          instance_url: "https://uazapi.example.com",
          instance_token: "instance-token",
        },
      ],
      error: null,
    });
    createProviderMock.createProvider.mockReturnValue({
      name: "uazapi",
      parseWebhook: vi.fn(() => ({
        messageId: "wamid.a",
        phone: "5511999999999",
        pushName: "Ana",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      })),
    });
    enqueueOutcomeMock.tryEnqueueForNativeAgent.mockResolvedValue({
      handled: true,
      response: { ok: true, skipped: "debounced", enqueued: true },
    });

    const request = new NextRequest("https://crm.funilpersia.top/api/whatsapp/webhook", {
      method: "POST",
      body: JSON.stringify({ owner: "5511999999999", token: "instance-token", message: {} }),
      headers: { "content-type": "application/json" },
    });

    const response = await uazapiWebhookPost(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: "debounced", enqueued: true });
    expect(processIncomingMessageMock.processIncomingMessage).not.toHaveBeenCalled();
  });

  it("UAZAPI webhook falls through to legacy when enqueue raises or declines", async () => {
    const supabase = createSupabaseMock();
    createClientMock.mockReturnValue(supabase);
    validateSignatureMock.mockReturnValue({
      configured: false,
      mode: "off",
      valid: true,
      accepted: true,
      present: false,
      headerName: "x-signature",
    });
    ownerPhoneMock.mockReturnValue("5511999999999");
    webhookTokenMock.mockReturnValue("instance-token");
    ownerFallbackMock.mockReturnValue(true);
    getMatchMethodMock.mockReturnValue("token");
    supabase.queue("whatsapp_connections", {
      data: [
        {
          organization_id: "org-a",
          provider: "uazapi",
          status: "connected",
          instance_url: "https://uazapi.example.com",
          instance_token: "instance-token",
        },
      ],
      error: null,
    });
    createProviderMock.createProvider.mockReturnValue({
      name: "uazapi",
      parseWebhook: vi.fn(() => ({
        messageId: "wamid.a",
        phone: "5511999999999",
        pushName: "Ana",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      })),
    });
    enqueueOutcomeMock.tryEnqueueForNativeAgent.mockResolvedValue({
      handled: false,
      reason: "exception",
    });
    processIncomingMessageMock.processIncomingMessage.mockResolvedValue({
      ok: true,
      handledBy: "none",
    });

    const request = new NextRequest("https://crm.funilpersia.top/api/whatsapp/webhook", {
      method: "POST",
      body: JSON.stringify({ owner: "5511999999999", token: "instance-token", message: {} }),
      headers: { "content-type": "application/json" },
    });

    const response = await uazapiWebhookPost(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, handledBy: "none" });
    expect(processIncomingMessageMock.processIncomingMessage).toHaveBeenCalled();
  });
});
