// Backlog #12 Auditoria (mai/2026) — testes da interpolacao de
// `{{lead.X}}` no helper + handler set_lead_custom_field.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  hasLeadPlaceholders,
  interpolateLeadPlaceholders,
} from "@/lib/ai-agent/flow/lead-interpolation";
import { setLeadCustomFieldHandler } from "@/lib/ai-agent/tools/set-lead-custom-field";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("@/lib/segments/lead-hook", () => ({
  dispatchSegmentMembershipHook: vi.fn(),
}));

describe("Backlog #12: interpolateLeadPlaceholders", () => {
  it("substitui name/phone/email", () => {
    expect(
      interpolateLeadPlaceholders("Olá {{lead.name}}, telefone {{lead.phone}}", {
        name: "Joao",
        phone: "+5511999999999",
      }),
    ).toBe("Olá Joao, telefone +5511999999999");
  });

  it("substitui email isolado", () => {
    expect(
      interpolateLeadPlaceholders("Email: {{lead.email}}", {
        email: "joao@example.com",
      }),
    ).toBe("Email: joao@example.com");
  });

  it("chave desconhecida vira string vazia (silencioso)", () => {
    expect(
      interpolateLeadPlaceholders("Foo: {{lead.foo}} bar", { name: "X" }),
    ).toBe("Foo:  bar");
  });

  it("template sem placeholders retorna identico", () => {
    expect(
      interpolateLeadPlaceholders("Texto literal sem variaveis", {
        name: "Joao",
      }),
    ).toBe("Texto literal sem variaveis");
  });

  it("lead vazio remove todos placeholders", () => {
    expect(
      interpolateLeadPlaceholders("Olá {{lead.name}}!", {}),
    ).toBe("Olá !");
  });

  it("multiplas ocorrencias do mesmo placeholder", () => {
    expect(
      interpolateLeadPlaceholders("{{lead.name}}-{{lead.name}}-{{lead.name}}", {
        name: "X",
      }),
    ).toBe("X-X-X");
  });
});

describe("Backlog #12: hasLeadPlaceholders", () => {
  it("detecta placeholder", () => {
    expect(hasLeadPlaceholders("oi {{lead.name}}")).toBe(true);
  });

  it("retorna false sem placeholder", () => {
    expect(hasLeadPlaceholders("oi sem nada")).toBe(false);
  });

  it("ignora chaves nao-lead", () => {
    expect(hasLeadPlaceholders("{{org.name}}")).toBe(false);
  });
});

describe("Backlog #12: setLeadCustomFieldHandler interpola valor", () => {
  function ctxBase(overrides: Record<string, unknown> = {}) {
    return {
      organization_id: "org-1",
      lead_id: "lead-1",
      crm_conversation_id: "crm-1",
      agent_conversation_id: "ac-1",
      run_id: "",
      dry_run: false,
      ...overrides,
    };
  }

  it("substitui {{lead.name}} antes de salvar", async () => {
    const supabase = createSupabaseMock();
    // Lead lookup pra interpolacao
    supabase.queue("leads", {
      data: { name: "Maria", phone: null, email: null },
      error: null,
    });
    // custom_fields lookup
    supabase.queue("custom_fields", {
      data: { id: "cf-1", field_type: "text" },
      error: null,
    });
    // upsert OK
    supabase.queue("lead_custom_field_values", { data: null, error: null });

    const result = await setLeadCustomFieldHandler(
      { ...ctxBase(), db: supabase as never } as never,
      { field_key: "saudacao", value: "Olá {{lead.name}}!" },
    );

    expect(result.success).toBe(true);
    // O supabase-mock atual nao expoe `upserts` separadamente — verifica
    // o output do handler que carrega o valor interpolado pos-substituicao.
    expect((result.output as { value?: string }).value).toBe("Olá Maria!");
  });

  it("dry_run reporta interpolacao mas nao toca DB", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { name: "Pedro", phone: null, email: null },
      error: null,
    });

    const result = await setLeadCustomFieldHandler(
      { ...ctxBase({ dry_run: true }), db: supabase as never } as never,
      { field_key: "saudacao", value: "Oi {{lead.name}}" },
    );

    expect(result.success).toBe(true);
    expect((result.output as { value?: string; simulated?: boolean }).value).toBe("Oi Pedro");
    expect((result.output as { simulated?: boolean }).simulated).toBe(true);
    expect((result.output as { raw_value?: string }).raw_value).toBe("Oi {{lead.name}}");
  });

  it("valor sem placeholder NAO consulta lead (short-circuit)", async () => {
    const supabase = createSupabaseMock();
    // SO custom_fields + upsert — NAO queue leads (porque short-circuit
    // evita a query). Se o codigo regredir e tentar buscar lead, vai
    // pegar custom_fields no lugar e quebrar.
    supabase.queue("custom_fields", {
      data: { id: "cf-2", field_type: "text" },
      error: null,
    });
    supabase.queue("lead_custom_field_values", { data: null, error: null });

    const result = await setLeadCustomFieldHandler(
      { ...ctxBase(), db: supabase as never } as never,
      { field_key: "campo", value: "valor literal sem variaveis" },
    );

    expect(result.success).toBe(true);
    expect((result.output as { value?: string }).value).toBe("valor literal sem variaveis");
  });
});
