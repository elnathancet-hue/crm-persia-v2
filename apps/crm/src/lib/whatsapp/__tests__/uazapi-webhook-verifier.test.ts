import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateUazapiWebhookSignature } from "@/lib/whatsapp/uazapi-webhook-verifier";

function sign(rawBody: string, secret: string) {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

describe("uazapi webhook verifier", () => {
  it("accepts every request when no signature secret is configured", () => {
    const result = validateUazapiWebhookSignature({
      rawBody: "{}",
      headers: new Headers(),
    });

    expect(result).toMatchObject({
      mode: "off",
      configured: false,
      accepted: true,
    });
  });

  it("validates sha256 signatures in observe mode without rejecting invalid requests", () => {
    const result = validateUazapiWebhookSignature({
      rawBody: "{\"ok\":true}",
      headers: new Headers({ "x-signature": "sha256=bad" }),
      secret: "secret",
      mode: "observe",
    });

    expect(result).toMatchObject({
      mode: "observe",
      configured: true,
      present: true,
      valid: false,
      accepted: true,
      headerName: "x-signature",
    });
  });

  it("rejects invalid signatures only in enforce mode", () => {
    const result = validateUazapiWebhookSignature({
      rawBody: "{\"ok\":true}",
      headers: new Headers({ "x-signature": "sha256=bad" }),
      secret: "secret",
      mode: "enforce",
    });

    expect(result).toMatchObject({
      mode: "enforce",
      valid: false,
      accepted: false,
    });
  });

  it("accepts valid bare or prefixed sha256 signatures", () => {
    const rawBody = "{\"event\":\"messages\"}";
    const secret = "secret";
    const digest = sign(rawBody, secret);

    expect(
      validateUazapiWebhookSignature({
        rawBody,
        headers: new Headers({ "x-signature": digest }),
        secret,
        mode: "enforce",
      }).accepted,
    ).toBe(true);

    expect(
      validateUazapiWebhookSignature({
        rawBody,
        headers: new Headers({ "x-signature": `sha256=${digest}` }),
        secret,
        mode: "enforce",
      }).accepted,
    ).toBe(true);
  });
});
