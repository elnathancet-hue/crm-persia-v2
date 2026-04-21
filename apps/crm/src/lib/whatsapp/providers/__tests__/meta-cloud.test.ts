import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetaCloudAdapter, MetaCloudGraphError } from "@/lib/whatsapp/providers/meta-cloud";

const cfg = {
  phoneNumberId: "123456789",
  wabaId: "waba-1",
  accessToken: "Bearer-token",
  verifyToken: "verify",
};

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);
  const spy = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("MetaCloudAdapter.sendText", () => {
  let adapter: MetaCloudAdapter;
  beforeEach(() => {
    adapter = new MetaCloudAdapter(cfg);
  });

  it("POSTs to /messages with normalized phone and returns messageId", async () => {
    const spy = mockFetchOnce({ messages: [{ id: "wamid.ABC" }] });

    const result = await adapter.sendText({ phone: "+55 (11) 98888-0000", message: "hi" });

    expect(result).toEqual({ messageId: "wamid.ABC", success: true });
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/${cfg.phoneNumberId}/messages`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("5511988880000"); // digits only
    expect(body.type).toBe("text");
    expect(body.text.body).toBe("hi");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${cfg.accessToken}`);
  });

  it("includes reply context when replyTo is given", async () => {
    const spy = mockFetchOnce({ messages: [{ id: "m1" }] });
    await adapter.sendText({ phone: "5511999", message: "yo", replyTo: "wamid.PREV" });
    const body = JSON.parse((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.context).toEqual({ message_id: "wamid.PREV" });
  });

  it("throws MetaCloudGraphError on non-2xx", async () => {
    mockFetchOnce({ error: "bad" }, { ok: false, status: 400 });
    await expect(adapter.sendText({ phone: "5511", message: "x" })).rejects.toBeInstanceOf(
      MetaCloudGraphError,
    );
  });
});

describe("MetaCloudAdapter.sendTemplate", () => {
  it("sends template with components when provided", async () => {
    const adapter = new MetaCloudAdapter(cfg);
    const spy = mockFetchOnce({ messages: [{ id: "wamid.T" }] });

    const result = await adapter.sendTemplate({
      phone: "5511",
      templateName: "welcome",
      language: "pt_BR",
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
    });

    expect(result.messageId).toBe("wamid.T");
    const body = JSON.parse((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("welcome");
    expect(body.template.language.code).toBe("pt_BR");
    expect(body.template.components).toHaveLength(1);
  });

  it("omits components when empty (API requires absence, not empty array)", async () => {
    const adapter = new MetaCloudAdapter(cfg);
    const spy = mockFetchOnce({ messages: [{ id: "m" }] });
    await adapter.sendTemplate({
      phone: "5511",
      templateName: "simple",
      language: "en",
      components: [],
    });
    const body = JSON.parse((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.template).not.toHaveProperty("components");
  });
});

describe("MetaCloudAdapter.parseWebhook", () => {
  const adapter = new MetaCloudAdapter(cfg);

  it("returns null for empty body", () => {
    expect(adapter.parseWebhook(null)).toBeNull();
    expect(adapter.parseWebhook({})).toBeNull();
  });

  it("parses a peeled message (from/type at root)", () => {
    const msg = adapter.parseWebhook({
      id: "wamid.1",
      from: "5511988880000",
      type: "text",
      timestamp: "1700000000",
      text: { body: "hello" },
    });
    expect(msg).not.toBeNull();
    expect(msg!.messageId).toBe("wamid.1");
    expect(msg!.phone).toBe("5511988880000");
    expect(msg!.type).toBe("text");
    expect(msg!.text).toBe("hello");
    expect(msg!.isGroup).toBe(false);
  });

  it("parses full Meta envelope with text", () => {
    const envelope = {
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "Ana" } }],
                messages: [
                  {
                    id: "wamid.2",
                    from: "5521",
                    type: "text",
                    timestamp: "1700000001",
                    text: { body: "oi" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const msg = adapter.parseWebhook(envelope);
    expect(msg).not.toBeNull();
    expect(msg!.pushName).toBe("Ana");
    expect(msg!.text).toBe("oi");
    expect(msg!.timestamp).toBe(1700000001000);
  });

  it("maps media types and exposes mime via mediaMimeType", () => {
    const msg = adapter.parseWebhook({
      id: "m",
      from: "5511",
      type: "image",
      timestamp: "1700000000",
      image: { id: "media-id", mime_type: "image/jpeg", caption: "look" },
    });
    expect(msg!.type).toBe("image");
    expect(msg!.mediaMimeType).toBe("image/jpeg");
    expect(msg!.text).toBe("look"); // caption falls back into text
  });

  it('maps button/interactive to "text"', () => {
    const msg = adapter.parseWebhook({
      id: "m",
      from: "5511",
      type: "button",
      timestamp: "1700000000",
    });
    expect(msg!.type).toBe("text");
  });

  it("returns null for unmapped types", () => {
    const msg = adapter.parseWebhook({
      id: "m",
      from: "5511",
      type: "system",
      timestamp: "1700000000",
    });
    expect(msg).toBeNull();
  });
});

describe("MetaCloudAdapter unsupported methods", () => {
  const adapter = new MetaCloudAdapter(cfg);
  it("throws on sendLocation", async () => {
    await expect(
      adapter.sendLocation({ phone: "5511", latitude: 0, longitude: 0 }),
    ).rejects.toThrow(/does not support: sendLocation/);
  });
  it("throws on createGroup", async () => {
    await expect(adapter.createGroup("x")).rejects.toThrow(/does not support: createGroup/);
  });
  it("getQRCode returns null (no QR pairing)", async () => {
    expect(await adapter.getQRCode()).toBeNull();
  });
});
