// PR-A LEADFIX — Testes dos schemas Zod centralizados.
//
// Cobre os formatos brasileiros mais comuns que entram pelos forms,
// webhook UAZAPI, booking publico e API n8n. Garante que a
// normalizacao pra E.164 funciona e que valores invalidos sao
// rejeitados com mensagem PT-BR.

import { describe, it, expect } from "vitest";
import {
  phoneBR,
  phoneBROptional,
  emailSchema,
  emailOptional,
  cpfCnpjSchema,
  leadCreateSchema,
} from "@persia/shared/validation";

describe("phoneBR", () => {
  it("normaliza celular BR sem DDI pra E.164", () => {
    expect(phoneBR.parse("11987654321")).toBe("+5511987654321");
  });

  it("normaliza fixo BR (10 digitos) sem DDI", () => {
    expect(phoneBR.parse("1133224455")).toBe("+551133224455");
  });

  it("aceita formato com mascara", () => {
    expect(phoneBR.parse("(11) 98765-4321")).toBe("+5511987654321");
  });

  it("aceita formato com +55 e espacos", () => {
    expect(phoneBR.parse("+55 11 98765-4321")).toBe("+5511987654321");
  });

  it("aceita formato com 55 sem +", () => {
    expect(phoneBR.parse("5511987654321")).toBe("+5511987654321");
  });

  it("rejeita phone curto demais", () => {
    expect(() => phoneBR.parse("5511")).toThrow();
  });

  it("rejeita string vazia", () => {
    expect(() => phoneBR.parse("")).toThrow();
  });
});

describe("phoneBROptional", () => {
  it("retorna undefined pra string vazia", () => {
    expect(phoneBROptional.parse("")).toBeUndefined();
  });

  it("retorna undefined pra undefined", () => {
    expect(phoneBROptional.parse(undefined)).toBeUndefined();
  });

  it("normaliza quando preenchido", () => {
    expect(phoneBROptional.parse("11987654321")).toBe("+5511987654321");
  });

  it("rejeita phone invalido se preenchido", () => {
    expect(() => phoneBROptional.parse("123")).toThrow();
  });
});

describe("emailSchema", () => {
  it("normaliza pra lowercase trimmed", () => {
    expect(emailSchema.parse("  Ana@Example.COM  ")).toBe("ana@example.com");
  });

  it("rejeita formato invalido", () => {
    expect(() => emailSchema.parse("nao-tem-arroba")).toThrow();
  });
});

describe("emailOptional", () => {
  it("retorna undefined pra string vazia", () => {
    expect(emailOptional.parse("")).toBeUndefined();
  });

  it("normaliza quando preenchido", () => {
    expect(emailOptional.parse("Ana@Example.com")).toBe("ana@example.com");
  });
});

describe("cpfCnpjSchema", () => {
  it("aceita CPF valido com mascara", () => {
    // CPF com digito verificador valido
    expect(cpfCnpjSchema.parse("123.456.789-09")).toBe("12345678909");
  });

  it("aceita CNPJ valido", () => {
    // CNPJ com digito verificador valido
    expect(cpfCnpjSchema.parse("11.222.333/0001-81")).toBe("11222333000181");
  });

  it("rejeita CPF com digito invalido", () => {
    expect(() => cpfCnpjSchema.parse("111.111.111-11")).toThrow();
  });

  it("rejeita CPF com tamanho errado", () => {
    expect(() => cpfCnpjSchema.parse("12345")).toThrow();
  });

  it("retorna undefined pra string vazia", () => {
    expect(cpfCnpjSchema.parse("")).toBeUndefined();
  });
});

describe("leadCreateSchema", () => {
  it("aceita lead com phone apenas", () => {
    const result = leadCreateSchema.parse({
      name: "Ana",
      phone: "11987654321",
    });
    expect(result.phone).toBe("+5511987654321");
    expect(result.email).toBeUndefined();
  });

  it("aceita lead com email apenas", () => {
    const result = leadCreateSchema.parse({
      name: "Ana",
      email: "ana@b.com",
    });
    expect(result.email).toBe("ana@b.com");
    expect(result.phone).toBeUndefined();
  });

  it("rejeita lead sem phone E sem email", () => {
    expect(() =>
      leadCreateSchema.parse({ name: "Ana" }),
    ).toThrow(/canal de contato/);
  });

  it("aceita lead com phone + email + tudo", () => {
    const result = leadCreateSchema.parse({
      name: "Ana Silva",
      phone: "(11) 98765-4321",
      email: "ANA@example.com",
      source: "indicacao",
      status: "qualificando",
      channel: "whatsapp",
    });
    expect(result.phone).toBe("+5511987654321");
    expect(result.email).toBe("ana@example.com");
    expect(result.source).toBe("indicacao");
  });
});
