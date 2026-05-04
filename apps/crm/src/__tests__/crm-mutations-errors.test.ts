import { describe, expect, it, vi } from "vitest";
import { sanitizeMutationError } from "@persia/shared/crm";

vi.mock("server-only", () => ({}));

// PR-AUDX/PR-AUD6: testa o helper que mapeia erros do PostgREST/Supabase
// pra mensagens PT-BR amigaveis. Bug que motivou: `error.message` cru
// vazava nomes de constraints e detalhes de schema pro toast.error
// no cliente.
describe("sanitizeMutationError", () => {
  it("mapeia 23505 (unique_violation) pra mensagem de duplicata", () => {
    const err = sanitizeMutationError({ code: "23505", message: "raw" });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Ja existe um registro com esses dados.");
  });

  it("mapeia 23503 (foreign_key) pra mensagem de relacionamento", () => {
    const err = sanitizeMutationError({ code: "23503", message: "raw" });
    expect(err.message).toContain("registros relacionados");
  });

  it("mapeia 23502 (not_null) pra campo obrigatorio", () => {
    const err = sanitizeMutationError({ code: "23502", message: "raw" });
    expect(err.message).toBe("Campo obrigatorio nao preenchido.");
  });

  it("mapeia 23514 (check_violation) pra valor invalido", () => {
    const err = sanitizeMutationError({ code: "23514", message: "raw" });
    expect(err.message).toBe("Valor invalido pra esse campo.");
  });

  it("mapeia 42501 (RLS) pra permissao insuficiente", () => {
    const err = sanitizeMutationError({ code: "42501", message: "raw" });
    expect(err.message).toBe("Permissao insuficiente pra essa operacao.");
  });

  it("mapeia 57014 (statement timeout) pra mensagem de timeout", () => {
    const err = sanitizeMutationError({ code: "57014", message: "raw" });
    expect(err.message).toContain("demorou demais");
  });

  it("usa fallback custom quando codigo nao mapeia", () => {
    const err = sanitizeMutationError(
      { code: "99999", message: "raw mystery" },
      "Erro ao criar negocio",
    );
    expect(err.message).toBe("Erro ao criar negocio");
  });

  it("usa fallback default quando nao informado", () => {
    const err = sanitizeMutationError({ code: "99999", message: "raw" });
    expect(err.message).toBe("Operacao falhou. Tente novamente.");
  });

  it("heuristica: detecta 'duplicate key' sem code mapear", () => {
    const err = sanitizeMutationError({
      message: "duplicate key value violates unique constraint xyz",
    });
    expect(err.message).toBe("Ja existe um registro com esses dados.");
  });

  it("heuristica: detecta 'foreign key' sem code", () => {
    const err = sanitizeMutationError({
      message: "violates foreign key constraint deals_pipeline_id_fkey",
    });
    expect(err.message).toContain("registros relacionados");
  });

  it("heuristica: detecta 'violates row-level security' sem code", () => {
    const err = sanitizeMutationError({
      message: "new row violates row-level security policy for table deals",
    });
    expect(err.message).toBe("Permissao insuficiente pra essa operacao.");
  });

  it("heuristica: detecta 'timeout' sem code", () => {
    const err = sanitizeMutationError({
      message: "timeout exceeded",
    });
    expect(err.message).toContain("demorou demais");
  });

  it("retorna Error com fallback quando input nao e objeto", () => {
    const err = sanitizeMutationError(null);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Operacao falhou. Tente novamente.");

    const err2 = sanitizeMutationError("string error");
    expect(err2.message).toBe("Operacao falhou. Tente novamente.");

    const err3 = sanitizeMutationError(undefined, "Custom fallback");
    expect(err3.message).toBe("Custom fallback");
  });

  it("NAO retorna Error com a mensagem crua do Supabase", () => {
    // Garantia critica: nada de schema vaza.
    const cruz = "duplicate key value violates unique constraint \"deal_loss_reasons_organization_id_label_key\"";
    const err = sanitizeMutationError({ code: "23505", message: cruz });
    expect(err.message).not.toContain("constraint");
    expect(err.message).not.toContain("organization_id");
    expect(err.message).not.toContain("deal_loss_reasons");
  });

  it("loga no console.error pra debugging server-side", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sanitizeMutationError({
      code: "23505",
      message: "raw msg",
      details: "detail xyz",
      hint: "hint abc",
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[crm-mutation]",
      expect.objectContaining({
        code: "23505",
        message: "raw msg",
        details: "detail xyz",
        hint: "hint abc",
      }),
    );
    consoleSpy.mockRestore();
  });
});
