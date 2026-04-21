import { describe, expect, it } from "vitest";
import { createProvider, MetaCloudAdapter, UazapiAdapter } from "@/lib/whatsapp/providers";

describe("createProvider", () => {
  it("defaults to UAZAPI when provider is null/undefined", () => {
    const p = createProvider({
      instance_url: "https://uaz.example.com",
      instance_token: "tok",
    });
    expect(p).toBeInstanceOf(UazapiAdapter);
    expect(p.name).toBe("uazapi");
  });

  it('routes "uazapi" explicitly', () => {
    const p = createProvider({
      provider: "uazapi",
      instance_url: "https://uaz.example.com",
      instance_token: "tok",
    });
    expect(p).toBeInstanceOf(UazapiAdapter);
  });

  it("throws when UAZAPI credentials missing", () => {
    expect(() =>
      createProvider({ provider: "uazapi", instance_url: null, instance_token: null }),
    ).toThrow(/UAZAPI provider requires/);
  });

  it('routes "meta_cloud" with full credentials', () => {
    const p = createProvider({
      provider: "meta_cloud",
      phone_number_id: "pn",
      waba_id: "waba",
      access_token: "token",
      webhook_verify_token: "verify",
    });
    expect(p).toBeInstanceOf(MetaCloudAdapter);
    expect(p.name).toBe("meta_cloud");
  });

  it("throws when Meta Cloud credentials missing", () => {
    expect(() =>
      createProvider({
        provider: "meta_cloud",
        phone_number_id: "pn",
        waba_id: null,
        access_token: "t",
      }),
    ).toThrow(/Meta Cloud provider requires/);
  });

  it("throws on unknown provider kind", () => {
    expect(() =>
      createProvider({
        provider: "telegram",
        instance_url: "x",
        instance_token: "y",
      }),
    ).toThrow(/Unknown WhatsApp provider/);
  });
});
