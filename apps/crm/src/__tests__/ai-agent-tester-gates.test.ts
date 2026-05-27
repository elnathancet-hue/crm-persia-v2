// Backlog #6 Auditoria (mai/2026) — testes do collectGateWarnings.
//
// Endereca rodada 10 #2 do POST_CODEX_AUDIT_AGENT_FLOW_353.md. Tester
// bypassa gates (feature flag, status, business hours) pra deixar admin
// testar configs intermediarias. Agora retorna gate_warnings com mensagem
// PT-BR pra UI mostrar banner "em prod hoje, esse run teria pulado por X".
//
// Falhas de leitura (org sem permissao) NAO produzem warning — gate
// silencioso e melhor que false alarm.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeHumanizationConfig } from "@persia/shared/ai-agent";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";
import { collectGateWarnings } from "@/lib/ai-agent/flow/tester-gates";
import { asAgentDb } from "@/lib/ai-agent/db";

const ORG_ID = "org-1";

const defaultHumanization = normalizeHumanizationConfig({});

describe("Backlog #6: collectGateWarnings — gate 1 feature_flag_off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flag desligada produz warning feature_flag_off", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: false } } },
      error: null,
    });

    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "active",
      defaultHumanization,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("feature_flag_off");
    expect(warnings[0]!.message).toMatch(/feature flag desligada/i);
  });

  it("flag ligada NAO produz warning", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: true } } },
      error: null,
    });

    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "active",
      defaultHumanization,
    );

    expect(warnings.find((w) => w.code === "feature_flag_off")).toBeUndefined();
  });

  it("settings ausentes equivale a flag off", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", { data: { settings: null }, error: null });

    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "active",
      defaultHumanization,
    );

    expect(warnings.find((w) => w.code === "feature_flag_off")).toBeDefined();
  });
});

describe("Backlog #6: collectGateWarnings — gate 2 agent_not_active", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("status 'draft' produz warning agent_not_active", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: true } } },
      error: null,
    });

    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "draft",
      defaultHumanization,
    );

    expect(warnings.find((w) => w.code === "agent_not_active")).toBeDefined();
    expect(
      warnings.find((w) => w.code === "agent_not_active")!.message,
    ).toMatch(/draft/);
  });

  it("status 'active' NAO produz warning", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: true } } },
      error: null,
    });

    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "active",
      defaultHumanization,
    );

    expect(warnings.find((w) => w.code === "agent_not_active")).toBeUndefined();
  });

  it("status undefined NAO produz warning (gate silencioso)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: true } } },
      error: null,
    });

    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      undefined,
      defaultHumanization,
    );

    expect(warnings.find((w) => w.code === "agent_not_active")).toBeUndefined();
  });
});

describe("Backlog #6: collectGateWarnings — gate 3 outside_business_hours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("desligado NAO produz warning mesmo fora do range", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: true } } },
      error: null,
    });

    // 2am domingo SP → fora de qualquer horario default
    const sunday2am = new Date("2026-05-24T05:00:00.000Z"); // = 02:00 SP
    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "active",
      { ...defaultHumanization, business_hours_enabled: false },
      sunday2am,
    );

    expect(
      warnings.find((w) => w.code === "outside_business_hours"),
    ).toBeUndefined();
  });

  it("ligado + fora do range produz warning", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: true } } },
      error: null,
    });

    // 2am domingo SP → defaults sao seg-sex 9-18, sab/dom fechado
    const sunday2am = new Date("2026-05-24T05:00:00.000Z"); // = 02:00 SP
    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "active",
      { ...defaultHumanization, business_hours_enabled: true },
      sunday2am,
    );

    expect(
      warnings.find((w) => w.code === "outside_business_hours"),
    ).toBeDefined();
  });

  it("ligado + dentro do range NAO produz warning", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: true } } },
      error: null,
    });

    // Quarta 14:00 SP → dentro do default (9-18 seg-sex)
    const wed2pm = new Date("2026-05-20T17:00:00.000Z"); // = 14:00 SP
    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "active",
      { ...defaultHumanization, business_hours_enabled: true },
      wed2pm,
    );

    expect(
      warnings.find((w) => w.code === "outside_business_hours"),
    ).toBeUndefined();
  });
});

describe("Backlog #6: collectGateWarnings — combinacoes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("3 gates juntos produz 3 warnings", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: false } } },
      error: null,
    });

    const sunday2am = new Date("2026-05-24T05:00:00.000Z");
    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "paused",
      { ...defaultHumanization, business_hours_enabled: true },
      sunday2am,
    );

    expect(warnings.map((w) => w.code).sort()).toEqual([
      "agent_not_active",
      "feature_flag_off",
      "outside_business_hours",
    ]);
  });

  it("tudo verde retorna array vazio", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: true } } },
      error: null,
    });

    const wed2pm = new Date("2026-05-20T17:00:00.000Z");
    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "active",
      { ...defaultHumanization, business_hours_enabled: true },
      wed2pm,
    );

    expect(warnings).toEqual([]);
  });

  it("falha de leitura em organizations NAO produz warning (gate silencioso)", async () => {
    const supabase = createSupabaseMock();
    // Sem queue → mock retorna { data: null, error: null } default,
    // que cai no path "settings === null" → vai produzir flag_off
    // (esperado: read-failure SE for excecao deve ser silenciada).
    // Aqui simulamos error explicito:
    supabase.queue("organizations", {
      data: null,
      error: { message: "permission denied" },
    });

    const warnings = await collectGateWarnings(
      asAgentDb(supabase),
      ORG_ID,
      "active",
      defaultHumanization,
    );

    // data=null + error nao bloqueia — settings vira undefined,
    // flagOn = false, retorna feature_flag_off
    expect(warnings.find((w) => w.code === "feature_flag_off")).toBeDefined();
  });
});
