// Segments — resolve regras de segmento em IDs de leads correspondentes.
//
// PR-CRMOPS3: hoje os segmentos sao listas isoladas. Esta funcao
// conecta as `SegmentRules` ao filtro de leads, fazendo o segmento
// "fazer alguma coisa" — listLeads aceita `segmentId` e usa este
// helper pra restringir o resultado.
//
// Estrategia: resolve cada condition em um Set<lead_id> e combina via
// AND (intersect) ou OR (union) conforme `rules.operator`. Trade-off:
// 1 query por condition em vez de query monolitica. Aceita pra orgs
// ate ~10k leads. Otimizacao futura (SQL function ou view) deferida.
//
// Campos suportados:
//   - status, source, channel (eq, neq)
//   - score (gt, lt, gte, lte)
//   - tags (contains, not_contains) — via join lead_tags
//   - assigned_to (eq, neq, is_null) — PR-CRMOPS3
//   - created_at, last_interaction_at (older_than_days, newer_than_days, is_null)
//   - deal_pipeline_id (eq, neq) — Etapa 9: leads com deal no pipeline
//   - deal_stage_id (eq, neq) — Etapa 9: leads com deal na etapa
//   - deal_status (eq, neq, is_null) — Etapa 9: leads com deal no status; is_null = sem deal
//
// Fora de escopo (defer):
//   - operadores avancados (regex, between)

import type { SegmentRules, SegmentCondition } from "../types";

interface MinimalDb {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => unknown;
    };
  };
  rpc?: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
}

interface QueryBuilderLike {
  eq: (col: string, val: unknown) => QueryBuilderLike;
  neq: (col: string, val: unknown) => QueryBuilderLike;
  gt: (col: string, val: unknown) => QueryBuilderLike;
  gte: (col: string, val: unknown) => QueryBuilderLike;
  lt: (col: string, val: unknown) => QueryBuilderLike;
  lte: (col: string, val: unknown) => QueryBuilderLike;
  is: (col: string, val: unknown) => QueryBuilderLike;
  in: (col: string, vals: unknown[]) => QueryBuilderLike;
  limit: (n: number) => QueryBuilderLike;
  then: <T>(fn: (r: { data: unknown[] | null; error: { message: string } | null }) => T) => Promise<T>;
}

// Allowlist de fields aceitos. Defesa contra injection de field names
// — o ConditionBuilder so emite esses, mas se DB for corrompido,
// silenciamos campos invalidos em vez de lancar.
const DIRECT_FIELDS = new Set([
  "status",
  "source",
  "channel",
  "score",
  "assigned_to",
]);

const DATE_FIELDS = new Set([
  "created_at",
  "last_interaction_at",
]);

// Etapa 9: campos que exigem join via tabela deals.
const DEAL_FIELDS = new Set([
  "deal_pipeline_id",
  "deal_stage_id",
  "deal_status",
]);

/**
 * Resolve as regras de um segmento em uma lista de lead IDs do org.
 *
 * @returns array de lead IDs. Vazio = nenhum lead bate.
 *          null se rules e malformado / vazio (caller deve tratar como
 *          "sem filtro" — equivalente a nao filtrar por segmento).
 */
export async function findMatchingLeadIds(
  db: MinimalDb,
  orgId: string,
  rules: SegmentRules | null | undefined,
): Promise<string[] | null> {
  if (!rules || !Array.isArray(rules.conditions) || rules.conditions.length === 0) {
    return null;
  }

  // Resolve cada condition em paralelo
  const sets = await Promise.all(
    rules.conditions.map((cond) => resolveCondition(db, orgId, cond)),
  );

  // null em qualquer set = condition invalida → ignora ela
  // (em vez de zerar tudo). Mantem leniencia se schema mudar.
  const validSets = sets.filter((s): s is Set<string> => s !== null);
  if (validSets.length === 0) return null;

  if (rules.operator === "OR") {
    const union = new Set<string>();
    for (const s of validSets) {
      for (const id of s) union.add(id);
    }
    return Array.from(union);
  }

  // AND (default): intersecao
  const [first, ...rest] = validSets;
  let result = new Set(first);
  for (const s of rest) {
    result = new Set([...result].filter((id) => s.has(id)));
    if (result.size === 0) break;
  }
  return Array.from(result);
}

async function resolveCondition(
  db: MinimalDb,
  orgId: string,
  cond: SegmentCondition,
): Promise<Set<string> | null> {
  // SegmentCondition e Record<string, unknown> (formato JSONB livre).
  // Normaliza pra strings antes de processar — silencia condicao
  // malformada em vez de lancar.
  const field = typeof cond.field === "string" ? cond.field : null;
  const op = typeof cond.op === "string" ? cond.op : null;
  const value =
    typeof cond.value === "string"
      ? cond.value
      : cond.value == null
        ? ""
        : String(cond.value);

  if (!field || !op) return null;

  // Tags exige join em lead_tags (mesma tabela usada no listLeads filter).
  if (field === "tags") {
    return resolveTagsCondition(db, orgId, op, value);
  }

  // Datas tem operadores proprios (older_than_days, newer_than_days,
  // is_null) — convertem pra timestamp antes de aplicar.
  if (DATE_FIELDS.has(field)) {
    return resolveDateCondition(db, orgId, field, op, value);
  }

  if (DIRECT_FIELDS.has(field)) {
    return resolveDirectCondition(db, orgId, field, op, value);
  }

  // Etapa 9: campos via tabela deals.
  if (DEAL_FIELDS.has(field)) {
    return resolveDealCondition(db, orgId, field, op, value);
  }

  // Field nao suportado — silencia.
  return null;
}

async function resolveDirectCondition(
  db: MinimalDb,
  orgId: string,
  field: string,
  op: string,
  rawValue: string,
): Promise<Set<string> | null> {
  const baseQuery = db.from("leads").select("id").eq("organization_id", orgId) as unknown as QueryBuilderLike;

  // score e numerico — converte
  const value: unknown = field === "score" ? Number(rawValue) : rawValue;

  let query: QueryBuilderLike;
  switch (op) {
    case "eq": query = baseQuery.eq(field, value); break;
    case "neq": query = baseQuery.neq(field, value); break;
    case "gt": query = baseQuery.gt(field, value); break;
    case "gte": query = baseQuery.gte(field, value); break;
    case "lt": query = baseQuery.lt(field, value); break;
    case "lte": query = baseQuery.lte(field, value); break;
    case "is_null": query = baseQuery.is(field, null); break;
    default: return null;
  }

  const { data, error } = await query.limit(10000).then((r) => r);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[segments/match-leads] resolveDirect failed:", error.message);
    return null;
  }
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

async function resolveTagsCondition(
  db: MinimalDb,
  orgId: string,
  op: string,
  rawValue: string,
): Promise<Set<string> | null> {
  // value pode ser um id de tag ou nome — ConditionBuilder atual usa
  // um <Input> texto (tag id). Trata como string direta. Para "contem
  // multiplas tags", ConditionBuilder deveria emitir multiplas
  // conditions (uma por tag) — se vier separado por virgula, suportamos.
  const tagIds = rawValue.split(",").map((t) => t.trim()).filter(Boolean);
  if (tagIds.length === 0) return null;

  const baseQuery = db
    .from("lead_tags")
    .select("lead_id")
    .eq("organization_id", orgId) as unknown as QueryBuilderLike;
  const query = baseQuery.in("tag_id", tagIds);

  const { data, error } = await query.limit(10000).then((r) => r);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[segments/match-leads] resolveTags failed:", error.message);
    return null;
  }
  const matched = new Set(
    ((data ?? []) as { lead_id: string | null }[])
      .map((r) => r.lead_id)
      .filter((id): id is string => id !== null),
  );

  if (op === "contains") {
    return matched;
  }

  if (op === "not_contains") {
    // RPC NOT EXISTS — evita carregar todos os leads em memória.
    if (!db.rpc) {
      // eslint-disable-next-line no-console
      console.error("[segments/match-leads] resolveTags not_contains: db.rpc indisponível");
      return null;
    }
    const { data: rpcData, error: rpcErr } = await db.rpc("match_leads_not_tagged", { p_org_id: orgId, p_tag_ids: tagIds });
    if (rpcErr) {
      // eslint-disable-next-line no-console
      console.error("[segments/match-leads] resolveTags not_contains failed:", rpcErr.message);
      return null;
    }
    return new Set((Array.isArray(rpcData) ? rpcData as { id: string }[] : []).map((r) => r.id));
  }

  return null;
}

async function resolveDateCondition(
  db: MinimalDb,
  orgId: string,
  field: string,
  op: string,
  rawValue: string,
): Promise<Set<string> | null> {
  const baseQuery = db.from("leads").select("id").eq("organization_id", orgId) as unknown as QueryBuilderLike;

  if (op === "is_null") {
    // "nunca interagiu" pra last_interaction_at
    const { data, error } = await baseQuery.is(field, null).limit(10000).then((r) => r);
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[segments/match-leads] resolveDate is_null failed:", error.message);
      return null;
    }
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  }

  const days = Number(rawValue);
  if (!Number.isFinite(days) || days < 0) return null;
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query: QueryBuilderLike;
  if (op === "older_than_days") {
    // older = ANTES do threshold
    query = baseQuery.lt(field, threshold);
  } else if (op === "newer_than_days") {
    // newer = DEPOIS do threshold
    query = baseQuery.gt(field, threshold);
  } else {
    return null;
  }

  const { data, error } = await query.limit(10000).then((r) => r);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[segments/match-leads] resolveDate failed:", error.message);
    return null;
  }
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

// ─── Strict mode (campanhas) ──────────────────────────────────────────────────
//
// Diferença do leniente:
//   - Campo inválido → throw
//   - Operador inválido → throw
//   - DB error em qualquer condition → throw
//   - null de resolução parcial → throw
//   - Resultado vazio → [] sem erro (lista vazia é válida)
//
// Usado exclusivamente por resolveCampaignAudience — nunca pelo preview
// visual de segmento.

export class StrictMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrictMatchError";
  }
}

export async function findMatchingLeadIdsStrict(
  db: MinimalDb,
  orgId: string,
  rules: SegmentRules | null | undefined,
): Promise<string[]> {
  if (!rules || !Array.isArray(rules.conditions) || rules.conditions.length === 0) {
    throw new StrictMatchError("Regras ausentes ou vazias");
  }

  const sets = await Promise.all(
    rules.conditions.map((cond) => resolveConditionStrict(db, orgId, cond)),
  );

  if (rules.operator === "OR") {
    const union = new Set<string>();
    for (const s of sets) {
      for (const id of s) union.add(id);
    }
    return Array.from(union);
  }

  // AND: intersecção — qualquer falha de DB já lançou acima
  const [first, ...rest] = sets;
  let result = new Set(first);
  for (const s of rest) {
    result = new Set([...result].filter((id) => s.has(id)));
    if (result.size === 0) break;
  }
  return Array.from(result);
}

async function resolveConditionStrict(
  db: MinimalDb,
  orgId: string,
  cond: SegmentCondition,
): Promise<Set<string>> {
  const field = typeof cond.field === "string" ? cond.field : null;
  const op = typeof cond.op === "string" ? cond.op : null;
  const value =
    typeof cond.value === "string"
      ? cond.value
      : cond.value == null
        ? ""
        : String(cond.value);

  if (!field) throw new StrictMatchError("Condition sem campo");
  if (!op) throw new StrictMatchError(`Campo "${field}": operador ausente`);

  if (field === "tags") {
    return resolveTagsConditionStrict(db, orgId, op, value);
  }
  if (DATE_FIELDS.has(field)) {
    return resolveDateConditionStrict(db, orgId, field, op, value);
  }
  if (DIRECT_FIELDS.has(field)) {
    return resolveDirectConditionStrict(db, orgId, field, op, value);
  }
  if (DEAL_FIELDS.has(field)) {
    return resolveDealConditionStrict(db, orgId, field, op, value);
  }

  throw new StrictMatchError(`Campo "${field}" não é suportado`);
}

async function resolveDirectConditionStrict(
  db: MinimalDb,
  orgId: string,
  field: string,
  op: string,
  rawValue: string,
): Promise<Set<string>> {
  const baseQuery = db.from("leads").select("id").eq("organization_id", orgId) as unknown as QueryBuilderLike;
  const value: unknown = field === "score" ? Number(rawValue) : rawValue;

  let query: QueryBuilderLike;
  switch (op) {
    case "eq": query = baseQuery.eq(field, value); break;
    case "neq": query = baseQuery.neq(field, value); break;
    case "gt": query = baseQuery.gt(field, value); break;
    case "gte": query = baseQuery.gte(field, value); break;
    case "lt": query = baseQuery.lt(field, value); break;
    case "lte": query = baseQuery.lte(field, value); break;
    case "is_null": query = baseQuery.is(field, null); break;
    default: throw new StrictMatchError(`Campo "${field}": operador "${op}" inválido`);
  }

  const { data, error } = await query.limit(10000).then((r) => r);
  if (error) throw new StrictMatchError(`DB error em "${field}": ${error.message}`);
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

async function resolveTagsConditionStrict(
  db: MinimalDb,
  orgId: string,
  op: string,
  rawValue: string,
): Promise<Set<string>> {
  const tagIds = rawValue.split(",").map((t) => t.trim()).filter(Boolean);
  if (tagIds.length === 0) throw new StrictMatchError("Campo tags: valor obrigatório");

  const baseQuery = db
    .from("lead_tags")
    .select("lead_id")
    .eq("organization_id", orgId) as unknown as QueryBuilderLike;
  const query = baseQuery.in("tag_id", tagIds);

  const { data, error } = await query.limit(10000).then((r) => r);
  if (error) throw new StrictMatchError(`DB error em "tags": ${error.message}`);

  const matched = new Set(
    ((data ?? []) as { lead_id: string | null }[])
      .map((r) => r.lead_id)
      .filter((id): id is string => id !== null),
  );

  if (op === "contains") return matched;

  if (op === "not_contains") {
    // RPC NOT EXISTS — evita carregar todos os leads em memória.
    if (!db.rpc) throw new StrictMatchError('Campo "tags" not_contains: db.rpc indisponível');
    const { data: rpcData, error: rpcErr } = await db.rpc("match_leads_not_tagged", { p_org_id: orgId, p_tag_ids: tagIds });
    if (rpcErr) throw new StrictMatchError(`DB error em "tags" not_contains: ${rpcErr.message}`);
    return new Set((Array.isArray(rpcData) ? rpcData as { id: string }[] : []).map((r) => r.id));
  }

  throw new StrictMatchError(`Campo "tags": operador "${op}" inválido`);
}

async function resolveDateConditionStrict(
  db: MinimalDb,
  orgId: string,
  field: string,
  op: string,
  rawValue: string,
): Promise<Set<string>> {
  const baseQuery = db.from("leads").select("id").eq("organization_id", orgId) as unknown as QueryBuilderLike;

  if (op === "is_null") {
    const { data, error } = await baseQuery.is(field, null).limit(10000).then((r) => r);
    if (error) throw new StrictMatchError(`DB error em "${field}" is_null: ${error.message}`);
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  }

  const days = Number(rawValue);
  if (!Number.isFinite(days) || days < 0) {
    throw new StrictMatchError(`Campo "${field}": valor de dias inválido`);
  }
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query: QueryBuilderLike;
  if (op === "older_than_days") {
    query = baseQuery.lt(field, threshold);
  } else if (op === "newer_than_days") {
    query = baseQuery.gt(field, threshold);
  } else {
    throw new StrictMatchError(`Campo "${field}": operador "${op}" inválido`);
  }

  const { data, error } = await query.limit(10000).then((r) => r);
  if (error) throw new StrictMatchError(`DB error em "${field}": ${error.message}`);
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

async function resolveDealConditionStrict(
  db: MinimalDb,
  orgId: string,
  field: string,
  op: string,
  rawValue: string,
): Promise<Set<string>> {
  const baseQuery = db
    .from("deals")
    .select("lead_id")
    .eq("organization_id", orgId) as unknown as QueryBuilderLike;

  if (op === "is_null") {
    // RPC NOT EXISTS — evita carregar todos os leads em memória.
    if (!db.rpc) throw new StrictMatchError(`Campo "${field}" is_null: db.rpc indisponível`);
    const { data: rpcData, error: rpcErr } = await db.rpc("match_leads_without_open_deal", { p_org_id: orgId });
    if (rpcErr) throw new StrictMatchError(`DB error em "${field}" is_null: ${rpcErr.message}`);
    return new Set((Array.isArray(rpcData) ? rpcData as { id: string }[] : []).map((r) => r.id));
  }

  if (!rawValue) throw new StrictMatchError(`Campo "${field}": valor obrigatório`);

  const dbCol = field === "deal_pipeline_id" ? "pipeline_id"
              : field === "deal_stage_id"    ? "stage_id"
              : /* deal_status */               "status";

  let query: QueryBuilderLike;
  if (op === "eq") {
    query = baseQuery.eq(dbCol, rawValue);
  } else if (op === "neq") {
    query = baseQuery.neq(dbCol, rawValue);
  } else {
    throw new StrictMatchError(`Campo "${field}": operador "${op}" inválido`);
  }

  const { data, error } = await query.limit(10000).then((r) => r);
  if (error) throw new StrictMatchError(`DB error em "${field}": ${error.message}`);
  return new Set(
    ((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id),
  );
}

// ─── Etapa 9: resolve conditions que exigem join via tabela deals. ────────────
// Retorna o Set de lead_ids que possuem deal satisfazendo a condition.
// Para "deal_status is_null" = "sem negócio aberto" — retorna leads
// que NAO possuem deal com status='open'.
async function resolveDealCondition(
  db: MinimalDb,
  orgId: string,
  field: string,
  op: string,
  rawValue: string,
): Promise<Set<string> | null> {
  const baseQuery = db
    .from("deals")
    .select("lead_id")
    .eq("organization_id", orgId) as unknown as QueryBuilderLike;

  // "Sem negócio aberto" — is_null no deal_status. RPC NOT EXISTS evita carregar todos os leads.
  if (op === "is_null") {
    if (!db.rpc) {
      // eslint-disable-next-line no-console
      console.error("[segments/match-leads] resolveDeal is_null: db.rpc indisponível");
      return null;
    }
    const { data: rpcData, error: rpcErr } = await db.rpc("match_leads_without_open_deal", { p_org_id: orgId });
    if (rpcErr) {
      // eslint-disable-next-line no-console
      console.error("[segments/match-leads] resolveDeal is_null failed:", rpcErr.message);
      return null;
    }
    return new Set((Array.isArray(rpcData) ? rpcData as { id: string }[] : []).map((r) => r.id));
  }

  if (!rawValue) return null;

  // Mapeia o campo virtual pro campo real na tabela deals.
  const dbCol = field === "deal_pipeline_id" ? "pipeline_id"
              : field === "deal_stage_id"    ? "stage_id"
              : /* deal_status */               "status";

  let query: QueryBuilderLike;
  if (op === "eq") {
    query = baseQuery.eq(dbCol, rawValue);
  } else if (op === "neq") {
    query = baseQuery.neq(dbCol, rawValue);
  } else {
    return null;
  }

  const { data, error } = await query.limit(10000).then((r) => r);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[segments/match-leads] resolveDeal failed:", error.message);
    return null;
  }
  return new Set(
    ((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id),
  );
}
