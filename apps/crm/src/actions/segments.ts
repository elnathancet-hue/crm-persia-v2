"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@persia/ui";
import { validateSegmentRules, findMatchingLeadIds } from "@persia/shared/crm";
import type { SegmentRules } from "@persia/shared/crm";
import type { SegmentPreviewResult } from "@persia/segments-ui";

function asErrorMessage(err: unknown, fallback = "Erro inesperado. Tente novamente."): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ============================================================================
// Etapa 12: observabilidade — logging estruturado de eventos de segmento.
// Falha de log nunca quebra o fluxo principal.
// ============================================================================

type SegmentEvent =
  | "segment_created"
  | "segment_updated"
  | "segment_deleted"
  | "segment_duplicated"
  | "segment_preview_computed"
  | "segment_invalid_rules"
  | "segment_error";

function logSegmentEvent(
  event: SegmentEvent,
  ctx: {
    organization_id?: string;
    segment_id?: string;
    lead_count?: number;
    error_message?: string;
  } = {},
): void {
  try {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event,
        ...ctx,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch {
    // Silencia — log nunca pode quebrar fluxo.
  }
}

export async function getSegments() {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("segments")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const segments = data ?? [];

  // Lazy-fix: recomputa lead_count para segmentos que têm regras mas
  // mostram 0 — cobre segmentos criados antes do fix que persiste o count.
  // Só atualiza se count > 0 para não iterar infinitamente em segmentos
  // que legitimamente têm 0 leads. Limitado a 5 por chamada.
  const stale = segments
    .filter(
      (s) =>
        s.lead_count === 0 &&
        Array.isArray((s.rules as { conditions?: unknown[] } | null)?.conditions) &&
        ((s.rules as { conditions?: unknown[] }).conditions?.length ?? 0) > 0,
    )
    .slice(0, 5);

  if (stale.length > 0) {
    const recomputed = await Promise.all(
      stale.map(async (s) => {
        try {
          const ids = await findMatchingLeadIds(supabase as never, orgId, s.rules as SegmentRules);
          const count = ids === null ? 0 : ids.length;
          if (count > 0) {
            await supabase
              .from("segments")
              .update({ lead_count: count } as never)
              .eq("id", s.id)
              .eq("organization_id", orgId);
            return { id: s.id, lead_count: count };
          }
        } catch {
          /* best effort */
        }
        return null;
      }),
    );
    const countMap = new Map(
      recomputed
        .filter((r): r is { id: string; lead_count: number } => r !== null)
        .map((r) => [r.id, r.lead_count]),
    );
    if (countMap.size > 0) {
      return segments.map((s) =>
        countMap.has(s.id) ? { ...s, lead_count: countMap.get(s.id)! } : s,
      );
    }
  }

  return segments;
}

export async function getSegment(id: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("segments")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ============================================================================
// Sprint 3: mutations migram pra ActionResult.
//
// Antes, recebiam FormData (legacy do form HTML) e davam throw em erro.
// Agora aceitam payload tipado (shape de objeto) e retornam ActionResult.
// O adapter @persia/segments-ui ja passa objeto, entao FormData nao
// e mais necessario.
// ============================================================================

interface CreateSegmentPayload {
  name: string;
  description?: string;
  rules: unknown;
}

interface UpdateSegmentPayload {
  name?: string;
  description?: string;
  rules?: unknown;
}

// Calcula lead_count e persiste no segmento. Best-effort: falha silenciosa.
async function refreshSegmentLeadCount(
  supabase: Awaited<ReturnType<typeof requireRole>>["supabase"],
  orgId: string,
  segmentId: string,
  rules: SegmentRules,
): Promise<void> {
  try {
    const ids = await findMatchingLeadIds(supabase as never, orgId, rules);
    const count = ids === null ? 0 : ids.length;
    await supabase
      .from("segments")
      .update({ lead_count: count } as never)
      .eq("id", segmentId)
      .eq("organization_id", orgId);
  } catch {
    // Best-effort — não quebra o fluxo principal.
  }
}

export async function createSegment(
  payload: CreateSegmentPayload,
): Promise<ActionResult<unknown>> {
  try {
    // Etapa 3: validação server-side (defesa em profundidade).
    const validation = validateSegmentRules(payload.rules as SegmentRules);
    if (!validation.valid) {
      logSegmentEvent("segment_invalid_rules", { error_message: validation.errors[0] });
      return { error: validation.errors[0] ?? "Regras inválidas" };
    }

    const { supabase, orgId } = await requireRole("admin");

    const { data, error } = await supabase
      .from("segments")
      .insert({
        organization_id: orgId,
        name: payload.name,
        description: payload.description || null,
        rules: (payload.rules ?? { operator: "AND", conditions: [] }) as never,
      } as never)
      .select()
      .single();

    if (error) {
      logSegmentEvent("segment_error", { organization_id: orgId, error_message: error.message });
      return { error: error.message };
    }

    const segmentId = (data as { id?: string })?.id;
    if (segmentId && payload.rules) {
      await refreshSegmentLeadCount(supabase, orgId, segmentId, payload.rules as SegmentRules);
    }

    logSegmentEvent("segment_created", { organization_id: orgId, segment_id: segmentId });
    revalidatePath("/segments");
    return { data };
  } catch (err) {
    logSegmentEvent("segment_error", { error_message: asErrorMessage(err) });
    return { error: asErrorMessage(err, "Não foi possível criar a segmentação.") };
  }
}

export async function updateSegment(
  id: string,
  payload: UpdateSegmentPayload,
): Promise<ActionResult<void>> {
  try {
    // Etapa 3: validação server-side quando rules estão sendo atualizadas.
    if (payload.rules !== undefined) {
      const validation = validateSegmentRules(payload.rules as SegmentRules);
      if (!validation.valid) {
        return { error: validation.errors[0] ?? "Regras inválidas" };
      }
    }

    const { supabase, orgId } = await requireRole("admin");

    const updates: Record<string, unknown> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.description !== undefined)
      updates.description = payload.description || null;
    if (payload.rules !== undefined) updates.rules = payload.rules;

    const { error } = await supabase
      .from("segments")
      .update(updates as never)
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) {
      logSegmentEvent("segment_error", { organization_id: orgId, segment_id: id, error_message: error.message });
      return { error: error.message };
    }

    // Recalcula lead_count sempre que as regras mudarem.
    if (payload.rules !== undefined) {
      await refreshSegmentLeadCount(supabase, orgId, id, payload.rules as SegmentRules);
    }

    logSegmentEvent("segment_updated", { organization_id: orgId, segment_id: id });
    revalidatePath("/segments");
    return;
  } catch (err) {
    logSegmentEvent("segment_error", { segment_id: id, error_message: asErrorMessage(err) });
    return { error: asErrorMessage(err, "Não foi possível atualizar a segmentação.") };
  }
}

export async function deleteSegment(id: string): Promise<ActionResult<void>> {
  try {
    const { supabase, orgId } = await requireRole("admin");

    const { error } = await supabase
      .from("segments")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) {
      logSegmentEvent("segment_error", { organization_id: orgId, segment_id: id, error_message: error.message });
      return { error: error.message };
    }
    logSegmentEvent("segment_deleted", { organization_id: orgId, segment_id: id });
    revalidatePath("/segments");
    return;
  } catch (err) {
    logSegmentEvent("segment_error", { segment_id: id, error_message: asErrorMessage(err) });
    return { error: asErrorMessage(err, "Não foi possível excluir a segmentação.") };
  }
}

// ============================================================================
// Etapa 4: preview de quantidade antes de salvar.
//
// Conta quantos leads bateriam com as regras fornecidas, sem salvar nada.
// Retorna também uma amostra curta (até 5) para o usuário avaliar a qualidade
// do segmento antes de confirmar.
// ============================================================================

export async function previewSegmentRules(
  rules: SegmentRules,
): Promise<SegmentPreviewResult> {
  // Valida antes de ir ao banco — evita query desnecessária.
  const validation = validateSegmentRules(rules);
  if (!validation.valid) {
    return { count: 0, sample: [], warnings: validation.errors };
  }

  const { supabase, orgId } = await requireRole("agent");

  // Supabase typed client satisfaz MinimalDb em runtime mas o checker
  // se perde na profundidade dos tipos gerados — `as never` evita TS2589.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = await findMatchingLeadIds(supabase as never, orgId, rules);

  if (ids === null) {
    return { count: 0, sample: [], warnings: ["Regras incompletas ou sem leads correspondentes"] };
  }

  if (ids.length === 0) {
    return { count: 0, sample: [], warnings: [] };
  }

  // Busca amostra de até 5 leads para exibição.
  const { data: sample } = await supabase
    .from("leads")
    .select("id, name, phone, status, source")
    .eq("organization_id", orgId)
    .in("id", ids.slice(0, 5));

  logSegmentEvent("segment_preview_computed", {
    organization_id: orgId,
    lead_count: ids.length,
  });

  return {
    count: ids.length,
    sample: (sample ?? []) as SegmentPreviewResult["sample"],
    warnings: [],
  };
}

// ============================================================================
// Etapa 8: duplicar segmento.
// Cria uma cópia com nome "Cópia de {nome}". Regras e descrição mantidas.
// ============================================================================

export async function duplicateSegment(id: string): Promise<ActionResult<unknown>> {
  try {
    const { supabase, orgId } = await requireRole("admin");

    const { data: original, error: fetchError } = await supabase
      .from("segments")
      .select("name, description, rules")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (fetchError || !original) {
      return { error: "Segmentação não encontrada" };
    }

    const { data, error } = await supabase
      .from("segments")
      .insert({
        organization_id: orgId,
        name: `Cópia de ${original.name}`,
        description: original.description || null,
        rules: (original.rules ?? { operator: "AND", conditions: [] }) as never,
      } as never)
      .select()
      .single();

    if (error) {
      logSegmentEvent("segment_error", { organization_id: orgId, segment_id: id, error_message: error.message });
      return { error: error.message };
    }

    const newSegmentId = (data as { id?: string })?.id;
    if (newSegmentId && original.rules) {
      await refreshSegmentLeadCount(supabase, orgId, newSegmentId, original.rules as SegmentRules);
    }

    logSegmentEvent("segment_duplicated", {
      organization_id: orgId,
      segment_id: newSegmentId,
    });
    revalidatePath("/segments");
    return { data };
  } catch (err) {
    logSegmentEvent("segment_error", { segment_id: id, error_message: asErrorMessage(err) });
    return { error: asErrorMessage(err, "Não foi possível duplicar a segmentação.") };
  }
}
