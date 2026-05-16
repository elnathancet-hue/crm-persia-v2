// PR-AGENDA-SEC (mai/2026): tests do helper `ensureCanActOnUser`
// que protege contra cross-agent write hole. Antes do fix, qualquer
// agent conseguia criar appointment com outro user como dono via
// `input.user_id`. Testes garantem que agora so admin/owner podem
// delegar; agent/viewer ficam restritos.

import { describe, expect, it } from "vitest";
import { ensureCanActOnUser } from "@/lib/agenda/security";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

describe("ensureCanActOnUser — cross-agent write protection", () => {
  it("permite quando inputUserId e undefined (default = caller)", () => {
    expect(() => ensureCanActOnUser(undefined, USER_A, "agent")).not.toThrow();
  });

  it("permite quando inputUserId e null", () => {
    expect(() => ensureCanActOnUser(null, USER_A, "agent")).not.toThrow();
  });

  it("permite agent agendar pra si mesmo", () => {
    expect(() => ensureCanActOnUser(USER_A, USER_A, "agent")).not.toThrow();
  });

  it("permite viewer agendar pra si mesmo (degenerate case)", () => {
    expect(() => ensureCanActOnUser(USER_A, USER_A, "viewer")).not.toThrow();
  });

  it("REJEITA agent agendando pra outro user", () => {
    expect(() => ensureCanActOnUser(USER_B, USER_A, "agent")).toThrowError(
      /admin ou dono/i,
    );
  });

  it("REJEITA viewer agendando pra outro user", () => {
    expect(() => ensureCanActOnUser(USER_B, USER_A, "viewer")).toThrowError(
      /admin ou dono/i,
    );
  });

  it("permite admin delegar (agendar pra outro user)", () => {
    expect(() => ensureCanActOnUser(USER_B, USER_A, "admin")).not.toThrow();
  });

  it("permite owner delegar (agendar pra outro user)", () => {
    expect(() => ensureCanActOnUser(USER_B, USER_A, "owner")).not.toThrow();
  });
});
