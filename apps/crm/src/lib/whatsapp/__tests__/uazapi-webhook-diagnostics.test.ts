import { describe, expect, it, vi } from "vitest";
import {
  extractUazapiOwnerPhone,
  extractUazapiWebhookToken,
  getUazapiConnectionMatchMethod,
  getUazapiWebhookDiagnostics,
  logUazapiWebhookDiagnostics,
} from "@/lib/whatsapp/uazapi-webhook-diagnostics";

describe("uazapi webhook diagnostics", () => {
  it("extracts owner and token from the current nested UAZAPI payload shape", () => {
    const body = {
      owner: "+55 (11) 98888-0000",
      token: "instance-token",
      EventType: "messages",
      message: { owner: "5511999999999", text: "secret message" },
    };

    expect(extractUazapiOwnerPhone(body)).toBe("5511988880000");
    expect(extractUazapiWebhookToken(body)).toBe("instance-token");
  });

  it("uses nested owner only when the top-level owner is absent", () => {
    expect(extractUazapiOwnerPhone({ message: { owner: "55 11 97777-0000" } })).toBe(
      "5511977770000",
    );
  });

  it("classifies token matches before legacy owner-phone matches", () => {
    const connection = {
      instance_token: "instance-token",
      phone_number: "+55 11 98888-0000",
    };

    expect(
      getUazapiConnectionMatchMethod(connection, {
        ownerPhone: "5511988880000",
        webhookToken: "instance-token",
      }),
    ).toBe("instance_token");
  });

  it("classifies owner phone as legacy fallback when token is missing", () => {
    const connection = {
      instance_token: "instance-token",
      phone_number: "+55 11 98888-0000",
    };

    expect(
      getUazapiConnectionMatchMethod(connection, {
        ownerPhone: "5511988880000",
        webhookToken: "",
      }),
    ).toBe("owner_phone_legacy");
  });

  it("returns safe shape diagnostics without raw token, phone, or message text", () => {
    const headers = new Headers({
      "x-signature": "signature-value",
    });
    const body = {
      token: "instance-token",
      owner: "5511988880000",
      EventType: "messages",
      message: { text: "secret message", chatid: "5511988880000@s.whatsapp.net" },
      chat: { id: "chat-id" },
    };

    const diagnostics = getUazapiWebhookDiagnostics({
      body,
      headers,
      matchedBy: "instance_token",
    });

    expect(diagnostics).toEqual({
      eventType: "messages",
      matchedBy: "instance_token",
      hasBodyToken: true,
      hasOwner: true,
      hasMessage: true,
      hasChat: true,
      headers: {
        hasXSignature: true,
        hasXUazapiSignature: false,
        hasXHubSignature256: false,
      },
      bodyKeys: ["EventType", "chat", "message", "owner", "token"],
      messageKeys: ["chatid", "text"],
      chatKeys: ["id"],
    });
    expect(JSON.stringify(diagnostics)).not.toContain("instance-token");
    expect(JSON.stringify(diagnostics)).not.toContain("5511988880000");
    expect(JSON.stringify(diagnostics)).not.toContain("secret message");
  });

  it("logs only legacy fallback by default", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logUazapiWebhookDiagnostics({
      body: { token: "instance-token" },
      headers: new Headers(),
      matchedBy: "instance_token",
    });
    logUazapiWebhookDiagnostics({
      body: { owner: "5511988880000" },
      headers: new Headers(),
      matchedBy: "owner_phone_legacy",
    });

    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();

    info.mockRestore();
    warn.mockRestore();
  });
});
