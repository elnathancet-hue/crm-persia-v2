"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";

// ============================================================================
// Tipos compartilhados com a UI (ImportLeadsWizard)
// ============================================================================

export interface ImportLeadRow {
  /** dados crus do CSV — keys = nome da coluna */
  [csvColumn: string]: string | number | null | undefined;
}

export interface ImportFieldMapping {
  csvColumn: string;
  /** id do campo do CRM (name/phone/email/company/source/value/notes/tags/responsible/status). 'ignore' = pula. */
  crmField: string;
}

export type DuplicateStrategy = "ignore" | "update" | "import";

export interface ImportDestination {
  /** Tags a aplicar em todos os leads importados (id existente OU nome novo). */
  tag_ids?: string[];
  tag_names_to_create?: string[];
  source?: string;
  status?: string;
  duplicate_strategy: DuplicateStrategy;
  /** Se true, cria um novo segmento que filtra leads desta importacao. */
  create_segment?: boolean;
  segment_name?: string;
  segment_description?: string;
}

export interface ImportLeadsInput {
  rows: ImportLeadRow[];
  mapping: ImportFieldMapping[];
  destination: ImportDestination;
}

export interface ImportLeadsResult {
  total_rows: number;
  invalid: { row_index: number; reason: string }[];
  created_count: number;
  updated_count: number;
  skipped_count: number;
  segment_id: string | null;
}

// ============================================================================
// Helpers de normalizacao (espelham o client pra dedup determinista)
// ============================================================================

function normalizePhone(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\D/g, "");
}

function normalizeEmail(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ============================================================================
// Action principal: importLeads
// ============================================================================

const MAX_ROWS = 5000;

/**
 * Server-side import. Cliente envia rows + mapping + destination.
 *
 * Pipeline:
 *   1. Validacao (max rows, mapping minimo)
 *   2. Normaliza cada row em LeadCandidate (snake_case alinhado com DB)
 *   3. Detecta duplicatas (phone normalizado OU email lowercased)
 *   4. Aplica strategy:
 *        - ignore: skip duplicatas, insere so novos
 *        - update: insere novos + atualiza existentes (merge notes, tags)
 *        - import: insere todos (cria duplicados — uso raro)
 *   5. Resolve/cria tags (por id existente OU por nome novo)
 *   6. Bulk insert leads + bulk insert lead_tags
 *   7. Cria segment se requested (rules JSONB com tags + status filter)
 *   8. Retorna stats + segment_id
 *
 * Multi-tenancy: organization_id sempre vem de requireRole, NUNCA do input.
 * RLS aplica naturalmente. Cap de MAX_ROWS pra evitar abuso.
 */
export async function importLeads(
  input: ImportLeadsInput,
): Promise<ImportLeadsResult> {
  const { supabase, orgId } = await requireRole("agent");

  if (input.rows.length === 0) {
    return {
      total_rows: 0,
      invalid: [],
      created_count: 0,
      updated_count: 0,
      skipped_count: 0,
      segment_id: null,
    };
  }
  if (input.rows.length > MAX_ROWS) {
    throw new Error(
      `Importação limitada a ${MAX_ROWS} linhas por vez (recebeu ${input.rows.length}). Quebre em arquivos menores.`,
    );
  }

  // ---- Step 1: Mapeamento minimo ----
  const fieldByCol = new Map<string, string>();
  for (const m of input.mapping) {
    if (m.crmField && m.crmField !== "ignore") {
      fieldByCol.set(m.csvColumn, m.crmField);
    }
  }
  const colsByField = new Map<string, string>();
  for (const [col, field] of fieldByCol) {
    if (!colsByField.has(field)) colsByField.set(field, col);
  }
  if (!colsByField.has("name")) {
    throw new Error("Mapeamento inválido: coluna 'Nome' obrigatória");
  }

  // ---- Step 2: Normaliza candidates ----
  interface LeadCandidate {
    name: string;
    phone: string | null;
    email: string | null;
    notes: string;
    rowIndex: number;
    /** Chave de dedup: phone normalizado OU email lowercased. */
    dedupKey: string | null;
    rawTags: string[];
    valueCents: number | null;
  }

  const invalid: ImportLeadsResult["invalid"] = [];
  const candidates: LeadCandidate[] = [];

  input.rows.forEach((row, idx) => {
    const name = asString(row[colsByField.get("name")!]);
    const phoneRaw = colsByField.get("phone")
      ? asString(row[colsByField.get("phone")!])
      : "";
    const emailRaw = colsByField.get("email")
      ? asString(row[colsByField.get("email")!])
      : "";

    if (!name) {
      invalid.push({ row_index: idx, reason: "Nome ausente" });
      return;
    }
    if (!phoneRaw && !emailRaw) {
      invalid.push({
        row_index: idx,
        reason: "Telefone e Email ausentes (preencha pelo menos um)",
      });
      return;
    }

    const phoneNorm = normalizePhone(phoneRaw);
    const emailNorm = normalizeEmail(emailRaw);

    const notesCol = colsByField.get("notes");
    const notes = notesCol ? asString(row[notesCol]) : "";

    const tagsCol = colsByField.get("tags");
    const rawTags = tagsCol
      ? asString(row[tagsCol])
          .split(/[,;|]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const valueCol = colsByField.get("value");
    const valueCents = valueCol
      ? (() => {
          const n = asNumber(row[valueCol]);
          return n === null ? null : Math.round(n * 100);
        })()
      : null;

    candidates.push({
      name,
      phone: phoneRaw || null,
      email: emailRaw || null,
      notes,
      rowIndex: idx,
      dedupKey: phoneNorm || emailNorm || null,
      rawTags,
      valueCents,
    });
  });

  // ---- Step 3: Detect duplicatas no DB ----
  const phonesToCheck = candidates
    .map((c) => normalizePhone(c.phone))
    .filter(Boolean);
  const emailsToCheck = candidates
    .map((c) => normalizeEmail(c.email))
    .filter(Boolean);

  // Carrega leads existentes da org que matchem
  const existingByPhone = new Map<string, string>();
  const existingByEmail = new Map<string, string>();

  if (phonesToCheck.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, phone")
      .eq("organization_id", orgId)
      .in("phone", phonesToCheck);
    if (error) throw new Error(`Lookup phones: ${error.message}`);
    for (const row of data ?? []) {
      const p = (row as { phone: string | null }).phone;
      if (p) existingByPhone.set(normalizePhone(p), (row as { id: string }).id);
    }
  }

  if (emailsToCheck.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, email")
      .eq("organization_id", orgId)
      .in("email", emailsToCheck);
    if (error) throw new Error(`Lookup emails: ${error.message}`);
    for (const row of data ?? []) {
      const e = (row as { email: string | null }).email;
      if (e)
        existingByEmail.set(normalizeEmail(e), (row as { id: string }).id);
    }
  }

  function findExistingId(c: LeadCandidate): string | null {
    if (c.phone) {
      const p = normalizePhone(c.phone);
      if (p && existingByPhone.has(p)) return existingByPhone.get(p)!;
    }
    if (c.email) {
      const e = normalizeEmail(c.email);
      if (e && existingByEmail.has(e)) return existingByEmail.get(e)!;
    }
    return null;
  }

  // ---- Step 4: Aplica strategy ----
  const toInsert: LeadCandidate[] = [];
  const toUpdate: { existingId: string; cand: LeadCandidate }[] = [];
  const skipped: LeadCandidate[] = [];

  for (const c of candidates) {
    const existingId = findExistingId(c);
    if (existingId) {
      if (input.destination.duplicate_strategy === "ignore") {
        skipped.push(c);
      } else if (input.destination.duplicate_strategy === "update") {
        toUpdate.push({ existingId, cand: c });
      } else {
        // 'import' = ignora dedup, insere mesmo
        toInsert.push(c);
      }
    } else {
      toInsert.push(c);
    }
  }

  // ---- Step 5: Resolve tags (existentes por id + novas por nome) ----
  const tagIds: string[] = [...(input.destination.tag_ids ?? [])];

  // Cria tags novas se solicitado
  if (
    input.destination.tag_names_to_create &&
    input.destination.tag_names_to_create.length > 0
  ) {
    const namesNew = input.destination.tag_names_to_create
      .map((s) => s.trim())
      .filter(Boolean);
    if (namesNew.length > 0) {
      // Procura quais ja existem com mesmo nome (case-insensitive nao trivial em SQL,
      // pra MVP fazemos case-sensitive — usuario vai querer 'VIP' diferente de 'vip' raramente)
      const { data: existingTags } = await supabase
        .from("tags")
        .select("id, name")
        .eq("organization_id", orgId)
        .in("name", namesNew);
      const existingNames = new Set(
        ((existingTags ?? []) as { name: string }[]).map((t) => t.name),
      );
      for (const t of (existingTags ?? []) as { id: string; name: string }[]) {
        tagIds.push(t.id);
      }

      const reallyNew = namesNew.filter((n) => !existingNames.has(n));
      if (reallyNew.length > 0) {
        const { data: created, error: tagErr } = await supabase
          .from("tags")
          .insert(
            reallyNew.map((name) => ({
              organization_id: orgId,
              name,
              color: "#6366f1", // primary indigo default
            })),
          )
          .select("id");
        if (tagErr) throw new Error(`Tags create: ${tagErr.message}`);
        for (const t of (created ?? []) as { id: string }[]) tagIds.push(t.id);
      }
    }
  }

  const dedupTagIds = Array.from(new Set(tagIds));

  // ---- Step 6: Bulk insert + bulk lead_tags ----
  let createdCount = 0;
  const createdLeadIds: string[] = [];

  if (toInsert.length > 0) {
    const insertRows = toInsert.map((c) => ({
      organization_id: orgId,
      name: c.name,
      phone: c.phone,
      email: c.email,
      source: input.destination.source ?? "import",
      status: input.destination.status ?? "new",
      channel: "whatsapp",
      metadata: c.notes ? { import_notes: c.notes } : {},
    }));

    // Supabase nao tem batch limit pratico de 5000 mas pra seguranca
    // dividimos em chunks de 500.
    const CHUNK = 500;
    for (let i = 0; i < insertRows.length; i += CHUNK) {
      const slice = insertRows.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("leads")
        .insert(slice)
        .select("id");
      if (error) throw new Error(`Insert leads: ${error.message}`);
      for (const r of (data ?? []) as { id: string }[]) {
        createdLeadIds.push(r.id);
        createdCount++;
      }
    }
  }

  // Updates (strategy=update): merge notes, mantem name se vazio etc
  let updatedCount = 0;
  const updatedLeadIds: string[] = [];
  for (const { existingId, cand } of toUpdate) {
    // Le valor atual pra merge defensivo
    const { data: current } = await supabase
      .from("leads")
      .select("name, email, metadata")
      .eq("id", existingId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const cur = (current ?? {}) as {
      name?: string | null;
      email?: string | null;
      metadata?: Record<string, unknown> | null;
    };

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (cand.name && !cur.name) patch.name = cand.name;
    if (cand.email && !cur.email) patch.email = cand.email;

    if (cand.notes) {
      const oldNotes =
        cur.metadata && typeof cur.metadata === "object"
          ? (cur.metadata as Record<string, unknown>).import_notes
          : null;
      const merged =
        typeof oldNotes === "string" && oldNotes
          ? `${oldNotes}\n\n${cand.notes}`
          : cand.notes;
      patch.metadata = {
        ...(cur.metadata ?? {}),
        import_notes: merged,
      };
    }

    const { error } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", existingId)
      .eq("organization_id", orgId);
    if (error) throw new Error(`Update lead ${existingId}: ${error.message}`);
    updatedCount++;
    updatedLeadIds.push(existingId);
  }

  // Aplica tags (em created + updated). Ignora conflito (UNIQUE em
  // lead_tags(lead_id, tag_id)).
  if (dedupTagIds.length > 0) {
    const allLeadIds = [...createdLeadIds, ...updatedLeadIds];
    if (allLeadIds.length > 0) {
      const links: { organization_id: string; lead_id: string; tag_id: string }[] =
        [];
      for (const leadId of allLeadIds) {
        for (const tagId of dedupTagIds) {
          links.push({
            organization_id: orgId,
            lead_id: leadId,
            tag_id: tagId,
          });
        }
      }
      // upsert ignora duplicados (UNIQUE constraint)
      const CHUNK = 1000;
      for (let i = 0; i < links.length; i += CHUNK) {
        const slice = links.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("lead_tags")
          .upsert(slice, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
        if (error) {
          // Em RLS estritos, fallback insert + ignore conflito
          console.warn(`[import] lead_tags upsert: ${error.message}`);
        }
      }
    }
  }

  // ---- Step 7: Cria segment se requested ----
  let segmentId: string | null = null;
  if (
    input.destination.create_segment &&
    input.destination.segment_name &&
    input.destination.segment_name.trim().length > 0
  ) {
    // Rules JSONB: filtra por tags do import + source=import
    // Usa shape do CRM atual (operator AND com conditions[]). Json-safe:
    // value sempre eh string (tag id ou source slug).
    const conditions: Array<{ field: string; op: string; value: string }> = [];
    if (dedupTagIds.length > 0) {
      // 1 condition por tag (op contains)
      for (const tid of dedupTagIds) {
        conditions.push({ field: "tags", op: "contains", value: tid });
      }
    }
    conditions.push({
      field: "source",
      op: "eq",
      value: input.destination.source ?? "import",
    });

    const { data, error } = await supabase
      .from("segments")
      .insert({
        organization_id: orgId,
        name: input.destination.segment_name.trim(),
        description:
          input.destination.segment_description?.trim() ||
          `Importado em ${new Date().toLocaleDateString("pt-BR")}`,
        rules: { operator: "AND", conditions },
        lead_count: createdCount + updatedCount,
      })
      .select("id")
      .single();
    if (error) {
      console.warn(`[import] create segment: ${error.message}`);
    } else if (data) {
      segmentId = (data as { id: string }).id;
    }
  }

  revalidatePath("/leads");
  revalidatePath("/segments");
  revalidatePath("/crm");

  return {
    total_rows: input.rows.length,
    invalid,
    created_count: createdCount,
    updated_count: updatedCount,
    skipped_count: skipped.length,
    segment_id: segmentId,
  };
}
