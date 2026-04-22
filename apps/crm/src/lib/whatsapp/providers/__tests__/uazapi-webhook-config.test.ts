import { describe, expect, it, vi } from "vitest";
import {
  buildUazapiWebhookConfig,
  configureUazapiWebhook,
} from "@persia/shared/providers";

describe("UAZAPI webhook config", () => {
  it("keeps the production webhook payload compatible with UAZAPI docs", () => {
    expect(buildUazapiWebhookConfig({ url: "https://crm.funilpersia.top/api/whatsapp/webhook" })).toEqual({
      enabled: true,
      url: "https://crm.funilpersia.top/api/whatsapp/webhook",
      events: ["messages"],
      excludeMessages: ["wasSentByApi"],
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
        events: ["messages"],
        excludeMessages: ["wasSentByApi"],
      }),
    });
  });
});
