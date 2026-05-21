// Bug B fix (mai/2026): unit tests do status mapper UAZAPI → DB.

import { describe, expect, it } from "vitest";
import { mapUazapiStatus } from "@/lib/whatsapp/uazapi-status-mapper";

describe("mapUazapiStatus", () => {
  it("mapeia sent variations pra sent", () => {
    expect(mapUazapiStatus("sent")).toBe("sent");
    expect(mapUazapiStatus("server_ack")).toBe("sent");
    expect(mapUazapiStatus("SERVER_ACK")).toBe("sent");
  });

  it("mapeia delivered variations pra delivered", () => {
    expect(mapUazapiStatus("delivered")).toBe("delivered");
    expect(mapUazapiStatus("delivery_ack")).toBe("delivered");
    expect(mapUazapiStatus("DELIVERY_ACK")).toBe("delivered");
    expect(mapUazapiStatus("Delivery_Ack")).toBe("delivered");
  });

  it("mapeia read variations pra read", () => {
    expect(mapUazapiStatus("read")).toBe("read");
    expect(mapUazapiStatus("READ")).toBe("read");
    expect(mapUazapiStatus("played")).toBe("read");
    expect(mapUazapiStatus("read_self")).toBe("read");
  });

  it("mapeia failure variations pra failed", () => {
    expect(mapUazapiStatus("error")).toBe("failed");
    expect(mapUazapiStatus("failed")).toBe("failed");
  });

  it("retorna null pra valor desconhecido", () => {
    expect(mapUazapiStatus("unknown_value")).toBeNull();
    expect(mapUazapiStatus("foo")).toBeNull();
  });

  it("retorna null pra non-string", () => {
    expect(mapUazapiStatus(null)).toBeNull();
    expect(mapUazapiStatus(undefined)).toBeNull();
    expect(mapUazapiStatus(123)).toBeNull();
    expect(mapUazapiStatus({})).toBeNull();
  });

  it("retorna null pra string vazia ou só whitespace", () => {
    expect(mapUazapiStatus("")).toBeNull();
    expect(mapUazapiStatus("   ")).toBeNull();
  });

  it("trim whitespace antes de match", () => {
    expect(mapUazapiStatus("  read  ")).toBe("read");
    expect(mapUazapiStatus("\tdelivery_ack\n")).toBe("delivered");
  });
});
