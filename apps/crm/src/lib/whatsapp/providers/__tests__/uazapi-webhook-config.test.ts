import { describe, expect, it, vi } from "vitest";
import {
  buildUazapiWebhookConfig,
  configureUazapiWebhook,
} from "@persia/shared/providers";

describe("UAZAPI webhook config", () => {
  it("keeps the production webhook payload compatible with UAZAPI docs", () => {
    // excludeMessages intentionally omitted: removing "wasSentByApi" allows ACK delivery
    // (messages_update events for our outbound msgs). Loop prevention is handled by
    // parseWebhook() returning null for fromMe=true. See b20c003 for full rationale.
    expect(buildUazapiWebhookConfig({ url: "https://crm.funilpersia.top/api/whatsapp/webhook" })).toEqual({
      enabled: true,
      url: "https://crm.funilpersia.top/api/whatsapp/webhook",
      events: ["messages", "messages_update"],
    });
  });

  it("posts the config to /webhook with the instance token header", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await configureUazapiWebhook({
      baseUrl: "https://persia.uazapi.com/",
      token: "instance-token",
      url: "https://crm.funilpersia.top/api/whatsapp/webhook",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://persia.uazapi.com/webhook", {
      method: "POST",
      headers: {
        token: "instance-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        url: "https://crm.funilpersia.top/api/whatsapp/webhook",
        events: ["messages", "messages_update"],
      }),
    });
  });
});
