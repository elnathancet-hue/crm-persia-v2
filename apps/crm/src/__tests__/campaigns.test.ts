// Testes obrigatórios do módulo de campanhas — Etapa 9 do roadmap.
// Cobre: strict matcher, audience resolver, worker, stop-on-reply.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findMatchingLeadIdsStrict,
  StrictMatchError,
  resolveCampaignAudience,
} from "@persia/shared/crm";
import type { SegmentRules } from "@persia/shared/crm";
import { validateMediaFile, detectMediaType } from "@/lib/campaigns/media-upload";
import { handleInboundReplyForCampaigns } from "@/lib/campaigns/stop-on-reply";

// ─── Helpers de mock ─────────────────────────────────────────────────────────

function makeDb(overrides: Record<string, unknown[]> = {}) {
  const tables: Record<string, unknown[]> = {
    leads: [
      { id: "l1", phone: "5511999990001", name: "Lead 1", status: "new", source: "website", channel: "whatsapp", score: 80, organization_id: "org1" },
      { id: "l2", phone: "5511999990002", name: "Lead 2", status: "qualified", source: "referral", channel: "whatsapp", score: 30, organization_id: "org1" },
      { id: "l3", phone: null, name: "Lead 3 sem fone", status: "new", source: "website", channel: null, score: 10, organization_id: "org1" },
    ],
    lead_tags: [
      { lead_id: "l1", tag_id: "t1", organization_id: "org1" },
    ],
    deals: [
      { lead_id: "l1", pipeline_id: "p1", stage_id: "s1", status: "open", organization_id: "org1" },
    ],
    ...overrides,
  };

  const query = (table: string, filters: Record<string, unknown> = {}) => ({
    _table: table,
    _filters: { ...filters },
    eq(col: string, val: unknown) {
      return query(table, { ...filters, [col]: val });
    },
    neq(col: string, val: unknown) {
      return query(table, { ...filters, [`${col}__neq`]: val });
    },
    gt(col: string, val: unknown) {
      return query(table, { ...filters, [`${col}__gt`]: val });
    },
    gte(col: string, val: unknown) {
      return query(table, { ...filters, [`${col}__gte`]: val });
    },
    lt(col: string, val: unknown) {
      return query(table, { ...filters, [`${col}__lt`]: val });
    },
    lte(col: string, val: unknown) {
      return query(table, { ...filters, [`${col}__lte`]: val });
    },
    is(col: string, val: unknown) {
      return query(table, { ...filters, [`${col}__is`]: val });
    },
    in(col: string, vals: unknown[]) {
      return query(table, { ...filters, [`${col}__in`]: vals });
    },
    select(cols: string) {
      return query(table, { ...filters, _cols: cols });
    },
    then<T>(fn: (r: { data: unknown[]; error: null }) => T): Promise<T> {
      const rows = tables[table] ?? [];
      const filtered = rows.filter((row) => {
        const r = row as Record<string, unknown>;
        for (const [k, v] of Object.entries(filters)) {
          if (k.startsWith("_")) continue;
          if (k.endsWith("__neq")) {
            if (r[k.replace("__neq", "")] === v) return false;
          } else if (k.endsWith("__gt")) {
            if (!(Number(r[k.replace("__gt", "")]) > Number(v))) return false;
          } else if (k.endsWith("__gte")) {
            if (!(Number(r[k.replace("__gte", "")]) >= Number(v))) return false;
          } else if (k.endsWith("__lt")) {
            if (!(Number(r[k.replace("__lt", "")]) < Number(v))) return false;
          } else if (k.endsWith("__lte")) {
            if (!(Number(r[k.replace("__lte", "")]) <= Number(v))) return false;
          } else if (k.endsWith("__is")) {
            if (r[k.replace("__is", "")] !== v) return false;
          } else if (k.endsWith("__in")) {
            const vals = v as unknown[];
            if (!vals.includes(r[k.replace("__in", "")])) return false;
          } else {
            if (r[k] !== v) return false;
          }
        }
        return true;
      });
      return Promise.resolve(fn({ data: filtered, error: null }));
    },
  });

  return {
    from: (table: string) => query(table),
  };
}

function makeErrorDb(table: string, errorMsg: string) {
  const failQuery: Record<string, unknown> = {
    then<T>(fn: (r: { data: null; error: { message: string } }) => T): Promise<T> {
      return Promise.resolve(fn({ data: null, error: { message: errorMsg } }));
    },
  };
  const makeFailChain = () => ({
    eq: () => makeFailChain(),
    neq: () => makeFailChain(),
    gt: () => makeFailChain(),
    lt: () => makeFailChain(),
    is: () => makeFailChain(),
    in: () => makeFailChain(),
    select: () => makeFailChain(),
    ...failQuery,
  });

  const normalDb = makeDb();
  return {
    from: (t: string) => {
      if (t === table) return makeFailChain();
      return normalDb.from(t);
    },
  };
}

// ─── Strict matcher ───────────────────────────────────────────────────────────

describe("findMatchingLeadIdsStrict", () => {
  const db = makeDb();

  it("retorna leads que batem com regras válidas", async () => {
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "new" }],
    };
    const ids = await findMatchingLeadIdsStrict(db as never, "org1", rules);
    expect(ids).toContain("l1");
    expect(ids).toContain("l3");
    expect(ids).not.toContain("l2");
  });

  it("retorna lista vazia (sem erro) quando nenhum lead bate", async () => {
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "closed_nonexistent" }],
    };
    const ids = await findMatchingLeadIdsStrict(db as never, "org1", rules);
    expect(ids).toEqual([]);
  });

  it("throws StrictMatchError para campo inválido", async () => {
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [{ field: "hacked_field", op: "eq", value: "x" }],
    };
    await expect(findMatchingLeadIdsStrict(db as never, "org1", rules)).rejects.toBeInstanceOf(StrictMatchError);
  });

  it("throws StrictMatchError para operador inválido", async () => {
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [{ field: "status", op: "invalid_op", value: "new" }],
    };
    await expect(findMatchingLeadIdsStrict(db as never, "org1", rules)).rejects.toBeInstanceOf(StrictMatchError);
  });

  it("throws StrictMatchError para rules vazias", async () => {
    await expect(
      findMatchingLeadIdsStrict(db as never, "org1", { operator: "AND", conditions: [] }),
    ).rejects.toBeInstanceOf(StrictMatchError);
  });

  it("throws StrictMatchError para rules null", async () => {
    await expect(
      findMatchingLeadIdsStrict(db as never, "org1", null),
    ).rejects.toBeInstanceOf(StrictMatchError);
  });

  it("throws StrictMatchError para DB error em condition (AND não ignora)", async () => {
    const errorDb = makeErrorDb("leads", "connection refused");
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "new" }],
    };
    await expect(findMatchingLeadIdsStrict(errorDb as never, "org1", rules)).rejects.toBeInstanceOf(StrictMatchError);
  });

  it("throws StrictMatchError para DB error em condition (OR não ignora)", async () => {
    const errorDb = makeErrorDb("leads", "timeout");
    const rules: SegmentRules = {
      operator: "OR",
      conditions: [{ field: "status", op: "eq", value: "new" }],
    };
    await expect(findMatchingLeadIdsStrict(errorDb as never, "org1", rules)).rejects.toBeInstanceOf(StrictMatchError);
  });

  it("score filter retorna leads com score > threshold", async () => {
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [{ field: "score", op: "gt", value: "50" }],
    };
    const ids = await findMatchingLeadIdsStrict(db as never, "org1", rules);
    expect(ids).toContain("l1");
    expect(ids).not.toContain("l2");
  });
});

// ─── Audience resolver ────────────────────────────────────────────────────────

describe("resolveCampaignAudience", () => {
  it("resolve leads com tag e marca sem telefone como inelegível", async () => {
    const db = makeDb({
      lead_tags: [
        { lead_id: "l1", tag_id: "t1", organization_id: "org1" },
        { lead_id: "l3", tag_id: "t1", organization_id: "org1" },
      ],
    });

    const result = await resolveCampaignAudience({
      kind: "lead_campaign",
      targets: [{ target_kind: "tag", target_id: "t1" }],
      db: db as never,
      orgId: "org1",
    });

    expect(result.found_count).toBe(2);
    expect(result.eligible_count).toBe(1); // l1 tem phone
    expect(result.ineligible_count).toBe(1); // l3 sem phone
    const l1 = result.recipients.find((r) => r.lead_id === "l1");
    const l3 = result.recipients.find((r) => r.lead_id === "l3");
    expect(l1?.eligible).toBe(true);
    expect(l3?.eligible).toBe(false);
    expect(l3?.ineligible_reason).toBeTruthy();
  });

  it("remove duplicatas quando mesmo lead aparece em múltiplos targets", async () => {
    const db = makeDb({
      lead_tags: [
        { lead_id: "l1", tag_id: "t1", organization_id: "org1" },
        { lead_id: "l1", tag_id: "t2", organization_id: "org1" },
      ],
    });

    const result = await resolveCampaignAudience({
      kind: "lead_campaign",
      targets: [
        { target_kind: "tag", target_id: "t1" },
        { target_kind: "tag", target_id: "t2" },
      ],
      db: db as never,
      orgId: "org1",
    });

    // l1 aparece em ambas as tags mas só conta uma vez
    const l1Count = result.recipients.filter((r) => r.lead_id === "l1").length;
    expect(l1Count).toBe(1);
  });

  it("retorna snapshot_hash estável", async () => {
    const db = makeDb({
      lead_tags: [{ lead_id: "l1", tag_id: "t1", organization_id: "org1" }],
    });

    const r1 = await resolveCampaignAudience({
      kind: "lead_campaign",
      targets: [{ target_kind: "tag", target_id: "t1" }],
      db: db as never,
      orgId: "org1",
    });
    const r2 = await resolveCampaignAudience({
      kind: "lead_campaign",
      targets: [{ target_kind: "tag", target_id: "t1" }],
      db: db as never,
      orgId: "org1",
    });

    expect(r1.snapshot_hash).toBe(r2.snapshot_hash);
    expect(typeof r1.snapshot_hash).toBe("string");
    expect(r1.snapshot_hash.length).toBeGreaterThan(0);
  });

  it("registra erro quando target_id ausente para lead target_kind tag", async () => {
    const db = makeDb();
    const result = await resolveCampaignAudience({
      kind: "lead_campaign",
      targets: [{ target_kind: "tag" }],
      db: db as never,
      orgId: "org1",
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/tag/i);
  });

  it("lead manual lista ids direto dos filters", async () => {
    const db = makeDb();
    const result = await resolveCampaignAudience({
      kind: "lead_campaign",
      targets: [{ target_kind: "manual", filters: { lead_ids: ["l1", "l2"] } }],
      db: db as never,
      orgId: "org1",
    });
    expect(result.found_count).toBe(2);
    expect(result.eligible_count).toBe(2); // l1 e l2 têm phone
  });
});

// ─── Media upload validation ──────────────────────────────────────────────────

describe("validateMediaFile", () => {
  function makeFile(name: string, type: string, size: number): File {
    const blob = new Blob(["x".repeat(size)], { type });
    return new File([blob], name, { type });
  }

  it("aceita imagem JPEG dentro do limite", () => {
    const file = makeFile("foto.jpg", "image/jpeg", 1 * 1024 * 1024);
    expect(validateMediaFile(file)).toBeNull();
  });

  it("rejeita imagem acima de 8 MB", () => {
    const file = makeFile("grande.jpg", "image/jpeg", 9 * 1024 * 1024);
    const err = validateMediaFile(file);
    expect(err).not.toBeNull();
    expect(err?.error).toMatch(/grande/i);
  });

  it("rejeita arquivo vazio", () => {
    const file = makeFile("empty.mp4", "video/mp4", 0);
    expect(validateMediaFile(file)).not.toBeNull();
  });

  it("detecta tipo de mídia corretamente", () => {
    expect(detectMediaType("image/png")).toBe("image");
    expect(detectMediaType("video/mp4")).toBe("video");
    expect(detectMediaType("audio/mpeg")).toBe("audio");
    expect(detectMediaType("application/pdf")).toBe("document");
    expect(detectMediaType("text/csv")).toBe("document"); // fallback
  });
});

// ─── Stop-on-reply ────────────────────────────────────────────────────────────

// Cria mock de supabase que suporta chain arbitrário retornando thenables
function makeStopOnReplySupabase(
  recipientRows: unknown[],
  campaignData: unknown,
  updatedRecipients: string[],
  cancelledJobs: string[],
) {
  // Cria um proxy de query que suporta chain arbitrário de .eq()/.select() e termina
  // com .then() ou .maybeSingle(). Os resultados são definidos por tabela.
  const makeSelectChain = (table: string): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      eq: (_col: string, _val: unknown) => makeSelectChain(table),
      select: (_cols: string) => makeSelectChain(table),
      maybeSingle: () => {
        if (table === "crm_campaigns") return Promise.resolve({ data: campaignData, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      then: <T>(fn: (r: { data: unknown[]; error: null }) => T) => {
        const rows = table === "crm_campaign_recipients" ? recipientRows : [];
        return Promise.resolve(fn({ data: rows, error: null }));
      },
    };
    return chain;
  };

  return {
    from: (table: string) => ({
      select: (_cols: string) => makeSelectChain(table),
      update: (_data: Record<string, unknown>) => ({
        eq: (_col: string, val: unknown) => {
          // Registra o ID sendo atualizado
          if (table === "crm_campaign_recipients") updatedRecipients.push(val as string);
          if (table === "crm_campaign_message_jobs") cancelledJobs.push(val as string);
          // Retorna chain adicional para status filter (.eq("status", "queued"))
          return {
            eq: (_c2: string, _v2: unknown) => Promise.resolve({ data: null, error: null }),
            then: <T>(fn: (r: { data: null; error: null }) => T) => Promise.resolve(fn({ data: null, error: null })),
          };
        },
      }),
      insert: (_row: unknown) => Promise.resolve({ data: null, error: null }),
    }),
  };
}

describe("handleInboundReplyForCampaigns", () => {
  it("para jobs futuros quando campanha tem stop_on_reply=true", async () => {
    const updatedRecipients: string[] = [];
    const cancelledJobs: string[] = [];

    const supabase = makeStopOnReplySupabase(
      [{ id: "rec1", campaign_id: "camp1", status: "active" }],
      { id: "camp1", status: "running", stop_on_reply: true },
      updatedRecipients,
      cancelledJobs,
    );

    await handleInboundReplyForCampaigns({
      supabase: supabase as never,
      orgId: "org1",
      leadId: "l1",
      conversationId: "conv1",
      isGroup: false,
    });

    // Recipient foi marcado como stopped
    expect(updatedRecipients).toContain("rec1");
  });

  it("não faz nada para grupos (MVP desabilitado)", async () => {
    const updateSpy = vi.fn();
    const supabase = { from: () => ({ update: updateSpy }) };

    await handleInboundReplyForCampaigns({
      supabase: supabase as never,
      orgId: "org1",
      groupId: "g1",
      isGroup: true,
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("não afeta outro recipient quando lead não tem campanha ativa", async () => {
    const updatedRecipients: string[] = [];

    // Sem recipients ativos para este lead
    const supabase = makeStopOnReplySupabase(
      [],
      null,
      updatedRecipients,
      [],
    );

    await handleInboundReplyForCampaigns({
      supabase: supabase as never,
      orgId: "org1",
      leadId: "l-outro",
      isGroup: false,
    });

    // Nenhum recipient foi atualizado
    expect(updatedRecipients).toHaveLength(0);
  });
});
