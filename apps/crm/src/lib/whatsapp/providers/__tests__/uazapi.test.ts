import { describe, expect, it, vi } from "vitest";
import { UazapiAdapter } from "@/lib/whatsapp/providers/uazapi";

describe("UazapiAdapter.parseWebhook", () => {
  const adapter = new UazapiAdapter("https://uaz.example.com", "tok");

  it("returns null for messages sent by us (fromMe)", () => {
    expect(adapter.parseWebhook({ fromMe: true, chatid: "5511@s.whatsapp.net" })).toBeNull();
  });

  it("returns null for group messages", () => {
    expect(
      adapter.parseWebhook({ isGroup: true, chatid: "5511-group@g.us" }),
    ).toBeNull();
  });

  it("returns null when no phone can be extracted", () => {
    expect(adapter.parseWebhook({ chatid: "" })).toBeNull();
    expect(adapter.parseWebhook({ chatid: "@s.whatsapp.net" })).toBeNull();
  });

  it("parses basic text message", () => {
    const msg = adapter.parseWebhook({
      messageid: "3EB0ABC",
      chatid: "5511988880000@s.whatsapp.net",
      senderName: "Ana",
      text: "oi",
      messageType: "conversation",
      messageTimestamp: 1700000000,
      fromMe: false,
    });
    expect(msg).toEqual(
      expect.objectContaining({
        messageId: "3EB0ABC",
        phone: "5511988880000",
        pushName: "Ana",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
      }),
    );
  });

  it.each([
    ["imageMessage", "image"],
    ["audioMessage", "audio"],
    ["pttMessage", "audio"],
    ["videoMessage", "video"],
    ["documentMessage", "document"],
    ["locationMessage", "location"],
    ["contactMessage", "contact"],
    ["stickerMessage", "sticker"],
  ] as const)("maps messageType %s -> %s", (messageType, expected) => {
    const msg = adapter.parseWebhook({
      messageid: "x",
      chatid: "5511@s.whatsapp.net",
      messageType,
      text: "",
    });
    expect(msg!.type).toBe(expected);
  });

  it("carries fileURL to mediaUrl", () => {
    const msg = adapter.parseWebhook({
      messageid: "x",
      chatid: "5511@s.whatsapp.net",
      messageType: "imageMessage",
      fileURL: "https://files/uaz/x.jpg",
    });
    expect(msg!.mediaUrl).toBe("https://files/uaz/x.jpg");
  });
});

describe("UazapiAdapter.sendText", () => {
  it("calls UazapiClient.sendTextV2 and returns messageId", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    vi.stubGlobal("fetch", jsonFetch({ messageId: "UAZ-1" }));

    const result = await adapter.sendText({ phone: "5511988880000", message: "hi" });
    expect(result).toEqual({ messageId: "UAZ-1", success: true });
  });
});

// Helper: single OK fetch returning JSON
function jsonFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
}

// Helper: stubs fetch with a queue of responses (consumed FIFO). Each entry is
// either the JSON body (→ 200 OK) or a [body, { ok?, status? }] tuple.
type FetchEntry = unknown | [unknown, { ok?: boolean; status?: number }];
function queueFetch(entries: FetchEntry[]) {
  const q = [...entries];
  return vi.fn(async () => {
    if (q.length === 0) throw new Error("fetch queue exhausted");
    const entry = q.shift()!;
    const [body, init] = Array.isArray(entry) && entry.length === 2 ? entry : [entry, {}];
    const ok = (init as { ok?: boolean }).ok ?? true;
    const status = (init as { status?: number }).status ?? (ok ? 200 : 400);
    return {
      ok,
      status,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  });
}

describe("UazapiAdapter.sendMedia", () => {
  it("uses sendMediaV2 on happy path", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    const spy = jsonFetch({ messageId: "UAZ-M-1" });
    vi.stubGlobal("fetch", spy);

    const result = await adapter.sendMedia({
      phone: "5511988880000",
      type: "image",
      media: "data:image/jpeg;base64,AAA",
      caption: "cap",
    });

    expect(result.messageId).toBe("UAZ-M-1");
    expect(spy).toHaveBeenCalledOnce();
    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toContain("/send/media");
  });

  it("falls back to legacy /chat/send/image when v2 fails", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    const spy = queueFetch([
      ["boom", { ok: false, status: 500 }], // sendMediaV2 fails
      { MessageId: "UAZ-LEGACY-IMG" }, // legacy sendImage succeeds
    ]);
    vi.stubGlobal("fetch", spy);

    const result = await adapter.sendMedia({
      phone: "5511",
      type: "image",
      media: "data:image/jpeg;base64,AAA",
      caption: "cap",
    });

    expect(result.messageId).toBe("UAZ-LEGACY-IMG");
    expect(spy).toHaveBeenCalledTimes(2);
    const [legacyUrl] = spy.mock.calls[1] as unknown as [string];
    expect(legacyUrl).toContain("/chat/send/image");
  });

  it("falls back to /chat/send/document with fileName for documents", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    const spy = queueFetch([
      ["err", { ok: false }],
      { MessageId: "UAZ-DOC" },
    ]);
    vi.stubGlobal("fetch", spy);

    const result = await adapter.sendMedia({
      phone: "5511",
      type: "document",
      media: "data:application/pdf;base64,BBB",
      fileName: "contract.pdf",
    });

    expect(result.messageId).toBe("UAZ-DOC");
    const [url, init] = spy.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/chat/send/document");
    const body = JSON.parse(init.body as string);
    expect(body.FileName).toBe("contract.pdf");
  });
});

describe("UazapiAdapter.markAsRead", () => {
  it("uses v2 endpoint when it succeeds", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    const spy = jsonFetch({});
    vi.stubGlobal("fetch", spy);

    await adapter.markAsRead(["3EB0ABC"], "5511");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("falls back to legacy when v2 fails, swallowing errors", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    const spy = queueFetch([
      ["err", { ok: false }], // v2 fails
      ["err", { ok: false }], // legacy also fails — .catch swallows
    ]);
    vi.stubGlobal("fetch", spy);

    await expect(adapter.markAsRead(["id"], "5511")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("UazapiAdapter.setTyping", () => {
  it("calls setPresence on happy path", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    const spy = jsonFetch({});
    vi.stubGlobal("fetch", spy);

    await adapter.setTyping("5511", true);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/message/presence");
    const body = JSON.parse(init.body as string);
    expect(body.presence).toBe("composing");
  });

  it("swallows errors via legacy fallback", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    vi.stubGlobal(
      "fetch",
      queueFetch([
        ["err", { ok: false }],
        ["err", { ok: false }],
      ]),
    );
    await expect(adapter.setTyping("5511", false)).resolves.toBeUndefined();
  });
});

describe("UazapiAdapter.checkNumber", () => {
  it("returns true when any number is valid", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    vi.stubGlobal("fetch", jsonFetch({ "5511988880000": true }));
    expect(await adapter.checkNumber("5511988880000")).toBe(true);
  });

  it("returns false when no number is valid", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    vi.stubGlobal("fetch", jsonFetch({ "5511000000000": false }));
    expect(await adapter.checkNumber("5511000000000")).toBe(false);
  });
});

describe("UazapiAdapter.getStatus", () => {
  it("maps client shape to normalized SessionStatus", async () => {
    const adapter = new UazapiAdapter("https://uaz.example.com", "tok");
    vi.stubGlobal("fetch", jsonFetch({ connected: true, loggedIn: true }));
    expect(await adapter.getStatus()).toEqual({ connected: true, loggedIn: true });
  });
});
