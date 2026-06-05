"use server";

// Server actions do módulo de campanhas (crm_campaigns).
// Arquivo separado de campaigns.ts (legado) para não quebrar a UI antiga.

import { requireSuperadminForOrg } from "@/lib/auth";
import { uploadCampaignMedia } from "@/lib/campaigns/media-upload";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@persia/ui";
import type {
  CrmCampaign,
  CrmCampaignWithDetails,
  CreateCampaignDraftInput,
  UpdateCampaignDraftInput,
  CampaignAudiencePreview,
  CrmCampaignRecipient,
  CrmCampaignEvent,
} from "@persia/shared/crm";
import { createProvider } from "@persia/shared/providers";
import { resolveCampaignAudience } from "@persia/shared/crm";
import type { MediaUploadResult } from "@/lib/campaigns/media-upload";

function asErr(err: unknown, fallback = "Erro inesperado."): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ─── Listagem ─────────────────────────────────────────────────────────────────

export async function listCrmCampaigns(): Promise<CrmCampaign[]> {
  const { admin: supabase, orgId } = await requireSuperadminForOrg();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: { from: (t: string) => any } = supabase as any;
  const { data, error } = await db.from("crm_campaigns")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error((error as { message?: string }).message ?? "Erro");
  return (data ?? []) as CrmCampaign[];
}

// ─── Saúde do WhatsApp ────────────────────────────────────────────────────────

export interface WhatsAppConnectionStatus {
  connected: boolean;
  provider: string | null;
  phone: string | null;
}

export async function getWhatsAppConnectionStatus(): Promise<WhatsAppConnectionStatus> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    const { data } = await supabase
      .from("whatsapp_connections")
      .select("provider, status, phone_number_id")
      .eq("organization_id", orgId)
      .limit(1)
      .maybeSingle();
    if (!data) return { connected: false, provider: null, phone: null };
    const row = data as { provider: string; status: string; phone_number_id: string | null };
    return {
      connected: row.status === "connected",
      provider: row.provider ?? null,
      phone: row.phone_number_id ?? null,
    };
  } catch {
    return { connected: false, provider: null, phone: null };
  }
}

export async function getCrmCampaignDetails(id: string): Promise<CrmCampaignWithDetails | null> {
  const { admin: supabase, orgId } = await requireSuperadminForOrg();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: { from: (t: string) => any } = supabase as any;

  const { data: campaign, error } = await db.from("crm_campaigns")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();
  if (error || !campaign) return null;

  const countByStatus = async (table: string, campaignId: string, status: string) => {
    const { count } = await db.from(table)
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", status);
    return count ?? 0;
  };

  const [stepsRes, targetsRes,
    recipTotal, recipPending, recipActive, recipCompleted, recipStopped, recipFailed, recipIneligible,
    jobQueued, jobSent, jobFailed, jobSkipped, jobCancelled,
  ] = await Promise.all([
    db.from("crm_campaign_steps").select("*").eq("campaign_id", id).order("position"),
    db.from("crm_campaign_targets").select("*").eq("campaign_id", id),
    db.from("crm_campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", id).then((r: { count: number | null }) => r.count ?? 0),
    countByStatus("crm_campaign_recipients", id, "pending"),
    countByStatus("crm_campaign_recipients", id, "active"),
    countByStatus("crm_campaign_recipients", id, "completed"),
    countByStatus("crm_campaign_recipients", id, "stopped"),
    countByStatus("crm_campaign_recipients", id, "failed"),
    countByStatus("crm_campaign_recipients", id, "ineligible"),
    countByStatus("crm_campaign_message_jobs", id, "queued"),
    countByStatus("crm_campaign_message_jobs", id, "sent"),
    countByStatus("crm_campaign_message_jobs", id, "failed"),
    countByStatus("crm_campaign_message_jobs", id, "skipped"),
    countByStatus("crm_campaign_message_jobs", id, "cancelled"),
  ]);

  return {
    ...(campaign as CrmCampaign),
    steps: (stepsRes.data ?? []) as never,
    targets: (targetsRes.data ?? []) as never,
    recipient_counts: {
      total: recipTotal,
      pending: recipPending,
      active: recipActive,
      completed: recipCompleted,
      stopped: recipStopped,
      failed: recipFailed,
      ineligible: recipIneligible,
    },
    job_counts: {
      queued: jobQueued,
      sent: jobSent,
      failed: jobFailed,
      skipped: jobSkipped,
      cancelled: jobCancelled,
    },
  };
}

// ─── Draft CRUD ───────────────────────────────────────────────────────────────

export async function createCampaignDraft(
  input: CreateCampaignDraftInput,
): Promise<ActionResult<CrmCampaign>> {
  try {
    if (!input.name?.trim()) return { error: "Nome obrigatório" };
    if (!input.kind) return { error: "Tipo de campanha obrigatório" };
    if (!input.steps?.length) return { error: "Adicione pelo menos uma mensagem" };
    if (!input.targets?.length) return { error: "Selecione pelo menos um público" };

    const { admin: supabase, orgId, userId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    const { data: campaign, error: campErr } = await db.from("crm_campaigns")
      .insert({
        organization_id: orgId,
        name: input.name.trim(),
        description: input.description ?? null,
        kind: input.kind,
        mode: input.mode ?? "single",
        status: "draft",
        timezone: input.timezone ?? "America/Sao_Paulo",
        send_window_start: input.send_window_start ?? null,
        send_window_end: input.send_window_end ?? null,
        rate_limit_per_minute: input.rate_limit_per_minute ?? null,
        stop_on_reply: input.stop_on_reply ?? true,
        created_by: userId ?? null,
      } as never)
      .select()
      .single();

    if (campErr || !campaign) {
      return { error: campErr?.message ?? "Falha ao criar campanha" };
    }

    const campaignId = (campaign as { id: string }).id;

    // Steps
    if (input.steps.length > 0) {
      const stepRows = input.steps.map((s, i) => ({
        organization_id: orgId,
        campaign_id: campaignId,
        position: s.position ?? i + 1,
        send_mode: s.send_mode,
        scheduled_at: s.scheduled_at ?? null,
        delay_amount: s.delay_amount ?? null,
        delay_unit: s.delay_unit ?? null,
        message_text: s.message_text ?? null,
        media_type: s.media_type ?? "none",
        media_url: s.media_url ?? null,
        media_filename: s.media_filename ?? null,
        media_mime_type: s.media_mime_type ?? null,
        media_size: s.media_size ?? null,
        caption: s.caption ?? null,
        stop_if_replied: s.stop_if_replied ?? null,
      }));
      const { error: stepsErr } = await db.from("crm_campaign_steps").insert(stepRows);
      if (stepsErr) {
        // Cleanup campaign if steps fail
        await db.from("crm_campaigns").delete().eq("id", campaignId);
        return { error: `Erro ao criar mensagens: ${(stepsErr as { message?: string }).message ?? "erro"}` };
      }
    }

    // Targets
    if (input.targets.length > 0) {
      const targetRows = input.targets.map((t) => ({
        organization_id: orgId,
        campaign_id: campaignId,
        target_kind: t.target_kind,
        target_id: t.target_id ?? null,
        filters: t.filters ?? {},
      }));
      const { error: targetsErr } = await db.from("crm_campaign_targets").insert(targetRows);
      if (targetsErr) {
        await db.from("crm_campaigns").delete().eq("id", campaignId);
        return { error: `Erro ao salvar público: ${(targetsErr as { message?: string }).message ?? "erro"}` };
      }
    }

    revalidatePath("/campaigns");
    return { data: campaign as CrmCampaign };
  } catch (err) {
    return { error: asErr(err, "Não foi possível criar a campanha.") };
  }
}

export async function updateCampaignDraft(
  id: string,
  input: UpdateCampaignDraftInput,
): Promise<ActionResult<void>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    // Só permite atualizar se draft
    const { data: existing } = await db.from("crm_campaigns")
      .select("status")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (!existing) return { error: "Campanha não encontrada" };
    if ((existing as { status: string }).status !== "draft") {
      return { error: "Só é possível editar campanhas em rascunho" };
    }

    const updates: Record<string, unknown> = {};
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.description !== undefined) updates.description = input.description;
    if (input.mode !== undefined) updates.mode = input.mode;
    if (input.timezone !== undefined) updates.timezone = input.timezone;
    if (input.send_window_start !== undefined) updates.send_window_start = input.send_window_start;
    if (input.send_window_end !== undefined) updates.send_window_end = input.send_window_end;
    if (input.rate_limit_per_minute !== undefined) updates.rate_limit_per_minute = input.rate_limit_per_minute;
    if (input.stop_on_reply !== undefined) updates.stop_on_reply = input.stop_on_reply;

    if (Object.keys(updates).length > 0) {
      const { error } = await db.from("crm_campaigns")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) return { error: (error as { message?: string }).message ?? "Erro" };
    }

    // Replace steps if provided
    if (input.steps !== undefined) {
      await db.from("crm_campaign_steps").delete().eq("campaign_id", id);
      if (input.steps.length > 0) {
        const stepRows = input.steps.map((s, i) => ({
          organization_id: orgId,
          campaign_id: id,
          position: s.position ?? i + 1,
          send_mode: s.send_mode,
          scheduled_at: s.scheduled_at ?? null,
          delay_amount: s.delay_amount ?? null,
          delay_unit: s.delay_unit ?? null,
          message_text: s.message_text ?? null,
          media_type: s.media_type ?? "none",
          media_url: s.media_url ?? null,
          media_filename: s.media_filename ?? null,
          media_mime_type: s.media_mime_type ?? null,
          media_size: s.media_size ?? null,
          caption: s.caption ?? null,
          stop_if_replied: s.stop_if_replied ?? null,
        }));
        const { error: stepsErr } = await db.from("crm_campaign_steps").insert(stepRows);
        if (stepsErr) return { error: `Erro ao atualizar mensagens: ${(stepsErr as { message?: string }).message ?? "erro"}` };
      }
    }

    // Replace targets if provided
    if (input.targets !== undefined) {
      await db.from("crm_campaign_targets").delete().eq("campaign_id", id);
      if (input.targets.length > 0) {
        const targetRows = input.targets.map((t) => ({
          organization_id: orgId,
          campaign_id: id,
          target_kind: t.target_kind,
          target_id: t.target_id ?? null,
          filters: t.filters ?? {},
        }));
        const { error: targetsErr } = await db.from("crm_campaign_targets").insert(targetRows);
        if (targetsErr) return { error: `Erro ao atualizar público: ${(targetsErr as { message?: string }).message ?? "erro"}` };
      }
    }

    revalidatePath("/campaigns");
    return;
  } catch (err) {
    return { error: asErr(err, "Não foi possível atualizar a campanha.") };
  }
}

// ─── Validação ────────────────────────────────────────────────────────────────

export async function validateCampaign(id: string): Promise<ActionResult<CampaignAudiencePreview>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    const { data: campaign } = await db.from("crm_campaigns")
      .select("*, crm_campaign_steps(*), crm_campaign_targets(*)")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (!campaign) return { error: "Campanha não encontrada" };

    const c = campaign as Record<string, unknown>;
    const steps = (c.crm_campaign_steps as { media_type: string; media_url: string | null }[]) ?? [];
    const targets = (c.crm_campaign_targets as { target_kind: string; target_id: string | null; filters: Record<string, unknown> }[]) ?? [];

    if (steps.length === 0) return { error: "Adicione pelo menos uma mensagem" };

    // Valida mídia
    for (const step of steps) {
      if (step.media_type !== "none" && !step.media_url) {
        return { error: `Passo com mídia "${step.media_type}" não tem URL de arquivo` };
      }
    }

    if (targets.length === 0) return { error: "Configure pelo menos um público" };

    // Resolve público em strict mode
    const preview = await resolveCampaignAudience({
      kind: c.kind as "lead_campaign" | "group_campaign",
      targets: targets.map((t) => ({
        target_kind: t.target_kind as never,
        target_id: t.target_id,
        filters: t.filters ?? {},
      })),
      db: supabase as never,
      orgId,
    });

    if (preview.errors.length > 0) {
      return { error: preview.errors[0] };
    }

    await db.from("crm_campaign_events")
      .insert({
        organization_id: orgId,
        campaign_id: id,
        event_type: "campaign_validated",
        payload: {
          eligible_count: preview.eligible_count,
          ineligible_count: preview.ineligible_count,
          snapshot_hash: preview.snapshot_hash,
        },
      });

    return { data: preview };
  } catch (err) {
    return { error: asErr(err, "Não foi possível validar a campanha.") };
  }
}

export async function previewCampaignAudience(
  kind: "lead_campaign" | "group_campaign",
  targets: Array<{ target_kind: string; target_id: string | null; filters?: Record<string, unknown> }>
): Promise<ActionResult<CampaignAudiencePreview>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();

    if (targets.length === 0) return { error: "Configure pelo menos um público" };

    const preview = await resolveCampaignAudience({
      kind,
      targets: targets.map((t) => ({
        target_kind: t.target_kind as never,
        target_id: t.target_id,
        filters: t.filters ?? {},
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: supabase as any,
      orgId,
    });

    if (preview.errors.length > 0) {
      return { error: preview.errors[0] };
    }

    return { data: preview };
  } catch (err) {
    return { error: asErr(err, "Não foi possível buscar a prévia de público.") };
  }
}

// ─── Agendamento ──────────────────────────────────────────────────────────────

export async function scheduleCampaign(id: string): Promise<ActionResult<void>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    const { data: campaign } = await db.from("crm_campaigns")
      .select("*, crm_campaign_steps(*), crm_campaign_targets(*)")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (!campaign) return { error: "Campanha não encontrada" };

    const c = campaign as Record<string, unknown>;
    const status = c.status as string;
    if (status !== "draft") {
      return { error: "Só é possível agendar campanhas em rascunho. Use Retomar para campanhas pausadas." };
    }

    const steps = (c.crm_campaign_steps as Array<Record<string, unknown>>) ?? [];
    const targets = (c.crm_campaign_targets as Array<Record<string, unknown>>) ?? [];

    if (steps.length === 0) return { error: "Adicione pelo menos uma mensagem" };
    if (targets.length === 0) return { error: "Configure pelo menos um público" };

    // Validar mídia
    for (const step of steps) {
      if (step.media_type !== "none" && !step.media_url) {
        return { error: "Há mensagem com mídia sem arquivo enviado" };
      }
    }

    // Verificar provider WhatsApp
    const { data: conn } = await supabase
      .from("whatsapp_connections")
      .select("id, status")
      .eq("organization_id", orgId)
      .eq("status", "connected")
      .limit(1)
      .maybeSingle();

    if (!conn) {
      return { error: "Nenhum WhatsApp conectado — conecte antes de agendar" };
    }

    // Resolver público em strict mode
    const preview = await resolveCampaignAudience({
      kind: c.kind as "lead_campaign" | "group_campaign",
      targets: targets.map((t) => ({
        target_kind: t.target_kind as never,
        target_id: (t.target_id as string) ?? null,
        filters: (t.filters as Record<string, unknown>) ?? {},
      })),
      db: supabase as never,
      orgId,
    });

    if (preview.errors.length > 0) {
      return { error: preview.errors[0] };
    }

    if (preview.eligible_count === 0) {
      return { error: "Nenhum destinatário elegível encontrado" };
    }

    // Rascunhos podem ser validados/agendados mais de uma vez durante a criação.
    // Limpa snapshot anterior antes de congelar o público atual.
    await db.from("crm_campaign_message_jobs").delete().eq("campaign_id", id);
    await db.from("crm_campaign_recipients").delete().eq("campaign_id", id);

    // Inserir recipients
    const eligibleRecipients = preview.recipients.filter((r) => r.eligible);
    const ineligibleRecipients = preview.recipients.filter((r) => !r.eligible);

    const recipientRows = [
      ...eligibleRecipients.map((r) => ({
        organization_id: orgId,
        campaign_id: id,
        recipient_type: r.recipient_type,
        lead_id: r.lead_id ?? null,
        group_id: r.group_id ?? null,
        phone: r.phone ?? null,
        chat_jid: r.chat_jid ?? null,
        display_name: r.display_name ?? null,
        status: "active",
        resolved_from: r.resolved_from,
      })),
      ...ineligibleRecipients.map((r) => ({
        organization_id: orgId,
        campaign_id: id,
        recipient_type: r.recipient_type,
        lead_id: r.lead_id ?? null,
        group_id: r.group_id ?? null,
        phone: r.phone ?? null,
        chat_jid: r.chat_jid ?? null,
        display_name: r.display_name ?? null,
        status: "ineligible",
        ineligible_reason: r.ineligible_reason ?? null,
        resolved_from: r.resolved_from,
      })),
    ];

    if (recipientRows.length > 0) {
      // Inserir em batches de 500
      for (let i = 0; i < recipientRows.length; i += 500) {
        const batch = recipientRows.slice(i, i + 500);
        const { error: recErr } = await db.from("crm_campaign_recipients")
          .insert(batch);
        if (recErr) return { error: `Erro ao salvar destinatários: ${recErr.message}` };
      }
    }

    // Buscar recipients ativos recém-inseridos
    const { data: activeRecipients } = await db.from("crm_campaign_recipients")
      .select("id")
      .eq("campaign_id", id)
      .eq("status", "active");

    const activeIds = ((activeRecipients ?? []) as { id: string }[]).map((r) => r.id);

    // Criar jobs para cada step × recipient ativo, preservando delays como
    // linha do tempo por destinatário.
    const now = new Date();
    const jobRows: Array<Record<string, unknown>> = [];
    const orderedSteps = [...steps].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));

    // Intervalo mínimo entre jobs do mesmo step para respeitar rate_limit_per_minute.
    // Ex: 20 msg/min → 1 job a cada 3 s. Default (null) = sem controle.
    const rateLimit = (c.rate_limit_per_minute as number | null) ?? null;
    const perStepIntervalMs = rateLimit && rateLimit > 0 ? Math.ceil(60_000 / rateLimit) : 0;

    // stepBaseTime[stepId] = timestamp base do próximo job desse step (para escalonamento)
    const stepBaseTime = new Map<string, number>();
    for (const step of orderedSteps) {
      stepBaseTime.set(step.id as string, now.getTime());
    }

    for (const recipId of activeIds) {
      let previousSendAt = now;
      for (const step of orderedSteps) {
        const stepId = step.id as string;
        const computedAt = computeStepSendAt(step, now, previousSendAt);

        // Se rate limit ativo, o send_at é o maior entre o tempo calculado
        // e o próximo slot disponível nesse step.
        let sendAt = computedAt;
        if (perStepIntervalMs > 0) {
          const nextSlot = new Date(Math.max(computedAt.getTime(), stepBaseTime.get(stepId)!));
          sendAt = nextSlot;
          stepBaseTime.set(stepId, nextSlot.getTime() + perStepIntervalMs);
        }

        jobRows.push({
          organization_id: orgId,
          campaign_id: id,
          step_id: stepId,
          recipient_id: recipId,
          send_at: sendAt.toISOString(),
          status: "queued",
          attempts: 0,
        });
        previousSendAt = sendAt;
      }
    }

    // Inserir jobs em batches (idempotente: constraint unique garante)
    for (let i = 0; i < jobRows.length; i += 500) {
      const batch = jobRows.slice(i, i + 500);
      const { error: jobsErr } = await db.from("crm_campaign_message_jobs")
        .upsert(batch, { onConflict: "campaign_id,step_id,recipient_id" });
      if (jobsErr) {
        await db.from("crm_campaign_message_jobs").delete().eq("campaign_id", id);
        await db.from("crm_campaign_recipients").delete().eq("campaign_id", id);
        return { error: `Erro ao criar fila de envio: ${jobsErr.message ?? "erro"}` };
      }
    }

    // Atualizar status
    await db.from("crm_campaigns")
      .update({ status: "scheduled" })
      .eq("id", id)
      .eq("organization_id", orgId);

    // Gravar evento
    await db.from("crm_campaign_events")
      .insert({
        organization_id: orgId,
        campaign_id: id,
        event_type: "campaign_scheduled",
        payload: {
          eligible_count: preview.eligible_count,
          ineligible_count: preview.ineligible_count,
          job_count: jobRows.length,
          snapshot_hash: preview.snapshot_hash,
        },
      });

    revalidatePath("/campaigns");
    return;
  } catch (err) {
    return { error: asErr(err, "Não foi possível agendar a campanha.") };
  }
}

// ─── Controles de estado ──────────────────────────────────────────────────────

export async function pauseCampaign(id: string): Promise<ActionResult<void>> {
  return setCampaignStatus(id, "paused", ["scheduled", "running"], "campaign_paused");
}

export async function resumeCampaign(id: string): Promise<ActionResult<void>> {
  return setCampaignStatus(id, "scheduled", ["paused"], "campaign_resumed");
}

export async function cancelCampaign(id: string): Promise<ActionResult<void>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    const { data: campaign } = await db.from("crm_campaigns")
      .select("status")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (!campaign) return { error: "Campanha não encontrada" };
    const currentStatus = (campaign as { status: string }).status;
    if (currentStatus === "completed" || currentStatus === "cancelled") {
      return { error: "Campanha já está finalizada" };
    }

    // Cancela jobs pendentes (sem apagar histórico)
    await db.from("crm_campaign_message_jobs")
      .update({ status: "cancelled" })
      .eq("campaign_id", id)
      .eq("status", "queued");

    await db.from("crm_campaigns")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("organization_id", orgId);

    await db.from("crm_campaign_events")
      .insert({
        organization_id: orgId,
        campaign_id: id,
        event_type: "campaign_cancelled",
        payload: { previous_status: currentStatus },
      });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${id}`);
    return;
  } catch (err) {
    return { error: asErr(err, "Não foi possível cancelar a campanha.") };
  }
}

async function setCampaignStatus(
  id: string,
  newStatus: string,
  allowedFrom: string[],
  eventType: string,
): Promise<ActionResult<void>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    const { data: campaign } = await db.from("crm_campaigns")
      .select("status")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (!campaign) return { error: "Campanha não encontrada" };
    const currentStatus = (campaign as { status: string }).status;
    if (!allowedFrom.includes(currentStatus)) {
      return { error: `Não é possível alterar status de "${currentStatus}"` };
    }

    await db.from("crm_campaigns")
      .update({ status: newStatus })
      .eq("id", id)
      .eq("organization_id", orgId);

    await db.from("crm_campaign_events")
      .insert({
        organization_id: orgId,
        campaign_id: id,
        event_type: eventType,
        payload: { previous_status: currentStatus, new_status: newStatus },
      });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${id}`);
    return;
  } catch (err) {
    return { error: asErr(err) };
  }
}

// ─── Destinatários ────────────────────────────────────────────────────────────

export async function getCampaignRecipients(
  campaignId: string,
  filter?: string,
): Promise<CrmCampaignRecipient[]> {
  const { admin: supabase, orgId } = await requireSuperadminForOrg();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: { from: (t: string) => any } = supabase as any;

  let query = db.from("crm_campaign_recipients")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  if (filter && filter !== "all") {
    query = query.eq("status", filter);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CrmCampaignRecipient[];
}

export async function deleteCrmCampaign(id: string): Promise<ActionResult<void>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    const { data: campaign } = await db.from("crm_campaigns")
      .select("status")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (!campaign) return { error: "Campanha não encontrada" };

    const status = (campaign as { status: string }).status;
    if (status === "scheduled" || status === "running") {
      return { error: "Cancele ou pause a campanha antes de excluir" };
    }

    const { error } = await db.from("crm_campaigns")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) return { error: error.message };

    revalidatePath("/campaigns");
    return;
  } catch (err) {
    return { error: asErr(err, "Não foi possível excluir a campanha.") };
  }
}

export async function bulkDeleteCrmCampaigns(ids: string[]): Promise<ActionResult<{ deleted: number; skipped: number }>> {
  try {
    if (!ids.length) return { data: { deleted: 0, skipped: 0 } };
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    const { data: campaigns } = await db.from("crm_campaigns")
      .select("id, status")
      .eq("organization_id", orgId)
      .in("id", ids);

    const rows = (campaigns ?? []) as { id: string; status: string }[];
    const deletable = rows.filter((c) => c.status !== "scheduled" && c.status !== "running").map((c) => c.id);
    const skipped = ids.length - deletable.length;

    if (deletable.length > 0) {
      await db.from("crm_campaigns").delete().eq("organization_id", orgId).in("id", deletable);
    }

    revalidatePath("/campaigns");
    return { data: { deleted: deletable.length, skipped } };
  } catch (err) {
    return { error: asErr(err, "Não foi possível excluir as campanhas.") };
  }
}

export async function listCampaignGroups(): Promise<Array<{ id: string; name: string; category: string | null; participant_count: number | null }>> {
  const { admin: supabase, orgId } = await requireSuperadminForOrg();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: { from: (t: string) => any } = supabase as any;

  const { data, error } = await db.from("whatsapp_groups")
    .select("id, name, category, participant_count")
    .eq("organization_id", orgId)
    .not("group_jid", "is", null)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; name: string; category: string | null; participant_count: number | null }>;
}

export async function uploadCampaignMediaAction(formData: FormData): Promise<ActionResult<MediaUploadResult>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "Arquivo não enviado" };

    const { data: buckets } = await admin.storage.listBuckets();
    if (!buckets?.some((bucket) => bucket.name === "campaign-media")) {
      await admin.storage.createBucket("campaign-media", { public: true });
    }

    const result = await uploadCampaignMedia(admin, {
      file,
      orgId,
      campaignId: `draft-${crypto.randomUUID()}`,
    });

    if ("error" in result) return { error: result.error };
    return { data: result };
  } catch (err) {
    return { error: asErr(err, "Não foi possível enviar a mídia.") };
  }
}

// ─── Eventos e Reprocessamento ──────────────────────────────────────────────────

export async function getCampaignEvents(campaignId: string): Promise<CrmCampaignEvent[]> {
  const { admin: supabase, orgId } = await requireSuperadminForOrg();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: { from: (t: string) => any } = supabase as any;

  const { data, error } = await db.from("crm_campaign_events")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CrmCampaignEvent[];
}

export async function reprocessCampaignFailures(campaignId: string): Promise<ActionResult<void>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    const { data: campaign } = await db.from("crm_campaigns")
      .select("status")
      .eq("id", campaignId)
      .eq("organization_id", orgId)
      .single();

    if (!campaign) return { error: "Campanha não encontrada" };
    const { data: failedJobs, error: listErr } = await db.from("crm_campaign_message_jobs")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("organization_id", orgId)
      .eq("status", "failed");

    if (listErr) return { error: `Erro ao buscar falhas: ${listErr.message}` };
    const failedIds = ((failedJobs ?? []) as Array<{ id: string }>).map((job) => job.id);
    if (failedIds.length === 0) return;

    // Altera os jobs com falha de volta para a fila
    const { error: jobsErr } = await db.from("crm_campaign_message_jobs")
      .update({ status: "queued", attempts: 0, last_error: null, locked_at: null, locked_by: null })
      .eq("campaign_id", campaignId)
      .eq("organization_id", orgId)
      .in("id", failedIds);

    if (jobsErr) return { error: `Erro ao reprocessar jobs: ${jobsErr.message}` };

    const reprocessedCount = failedIds.length;

    if (reprocessedCount > 0) {
      // Se estava concluída, volta para scheduled ou running
      if (campaign.status === "completed" || campaign.status === "failed") {
        await db.from("crm_campaigns")
          .update({ status: "scheduled" })
          .eq("id", campaignId)
          .eq("organization_id", orgId);
      }

      await db.from("crm_campaign_events")
        .insert({
          organization_id: orgId,
          campaign_id: campaignId,
          event_type: "campaign_failures_reprocessed",
          payload: { reprocessed_count: reprocessedCount },
        });
    }

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return;
  } catch (err) {
    return { error: asErr(err, "Não foi possível reprocessar as falhas.") };
  }
}

export async function duplicateCrmCampaign(id: string): Promise<ActionResult<string>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    // Busca original com relacionamentos
    const { data: original, error: fetchErr } = await db.from("crm_campaigns")
      .select("*, crm_campaign_steps(*), crm_campaign_targets(*)")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (fetchErr || !original) return { error: "Campanha original não encontrada" };

    const c = original as Record<string, unknown>;
    const newName = `${c.name} (Cópia)`;

    // Cria a nova campanha como draft
    const { data: newCampaign, error: insertErr } = await db.from("crm_campaigns")
      .insert({
        organization_id: orgId,
        name: newName,
        description: c.description,
        kind: c.kind,
        mode: c.mode,
        status: "draft", // forçamos para draft
        timezone: c.timezone,
        send_window_start: c.send_window_start,
        send_window_end: c.send_window_end,
        rate_limit_per_minute: c.rate_limit_per_minute,
        stop_on_reply: c.stop_on_reply,
      })
      .select("id")
      .single();

    if (insertErr || !newCampaign) return { error: insertErr?.message ?? "Falha ao duplicar" };

    const newId = newCampaign.id as string;

    // Copia os steps
    const steps = (c.crm_campaign_steps as Array<Record<string, unknown>>) ?? [];
    const nowMs = Date.now();
    if (steps.length > 0) {
      const newSteps = steps.map(s => {
        const scheduledAt = typeof s.scheduled_at === "string" ? s.scheduled_at : null;
        const scheduledIsPast = s.send_mode === "scheduled_at"
          && scheduledAt
          && new Date(scheduledAt).getTime() <= nowMs;

        return {
          organization_id: orgId,
          campaign_id: newId,
          position: s.position,
          send_mode: scheduledIsPast ? "immediate" : s.send_mode,
          delay_amount: scheduledIsPast ? null : s.delay_amount,
          delay_unit: scheduledIsPast ? null : s.delay_unit,
          scheduled_at: scheduledIsPast ? null : s.scheduled_at,
          message_text: s.message_text,
          media_type: s.media_type,
          media_url: s.media_url,
          media_filename: s.media_filename,
          media_mime_type: s.media_mime_type,
          media_size: s.media_size,
          caption: s.caption,
          stop_if_replied: s.stop_if_replied ?? null,
        };
      });
      const { error: stepsErr } = await db.from("crm_campaign_steps").insert(newSteps);
      if (stepsErr) {
        await db.from("crm_campaigns").delete().eq("id", newId).eq("organization_id", orgId);
        return { error: `Erro ao copiar mensagens: ${stepsErr.message ?? "erro"}` };
      }
    }

    // Copia os targets
    const targets = (c.crm_campaign_targets as Array<Record<string, unknown>>) ?? [];
    if (targets.length > 0) {
      const newTargets = targets.map(t => ({
        organization_id: orgId,
        campaign_id: newId,
        target_kind: t.target_kind,
        target_id: t.target_id,
        filters: t.filters,
      }));
      const { error: targetsErr } = await db.from("crm_campaign_targets").insert(newTargets);
      if (targetsErr) {
        await db.from("crm_campaigns").delete().eq("id", newId).eq("organization_id", orgId);
        return { error: `Erro ao copiar público: ${targetsErr.message ?? "erro"}` };
      }
    }

    revalidatePath("/campaigns");
    return { data: newId };
  } catch (err) {
    return { error: asErr(err, "Não foi possível duplicar a campanha.") };
  }
}

export async function sendCampaignTestMessage(campaignId: string, phone: string): Promise<ActionResult<void>> {
  try {
    const { admin: supabase, orgId } = await requireSuperadminForOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: { from: (t: string) => any } = supabase as any;

    const { data: campaign } = await db.from("crm_campaigns")
      .select("id, crm_campaign_steps(*)")
      .eq("id", campaignId)
      .eq("organization_id", orgId)
      .single();

    if (!campaign) return { error: "Campanha não encontrada" };

    const steps = ((campaign.crm_campaign_steps as Array<Record<string, unknown>>) ?? [])
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
    if (steps.length === 0) return { error: "Campanha sem mensagens para testar" };

    const cleanPhone = phone.replace(/\D/g, "");
    if (!cleanPhone) return { error: "Número inválido" };

    const { data: conn } = await supabase
      .from("whatsapp_connections")
      .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
      .eq("organization_id", orgId)
      .eq("status", "connected")
      .limit(1)
      .maybeSingle();

    if (!conn) return { error: "Nenhum WhatsApp conectado para enviar o teste" };

    const provider = createProvider(conn as never);
    const recipient = {
      display_name: "Teste Interno",
      phone: cleanPhone,
      chat_jid: null,
    };

    for (const step of steps) {
      const messageText = typeof step.message_text === "string" ? step.message_text : null;
      const captionText = typeof step.caption === "string" ? step.caption : null;
      const mediaType = typeof step.media_type === "string" ? step.media_type : "none";
      const mediaUrl = typeof step.media_url === "string" ? step.media_url : null;
      const mediaFilename = typeof step.media_filename === "string" ? step.media_filename : undefined;
      const message = interpolateCampaignTestText(messageText, recipient);
      const caption = interpolateCampaignTestText(captionText, recipient) ?? message ?? undefined;
      if (mediaType !== "none" && mediaUrl) {
        await provider.sendMedia({
          phone: cleanPhone,
          type: mediaType as "image" | "video" | "audio" | "document",
          media: mediaUrl,
          fileName: mediaFilename,
          caption,
        });
      } else if (message) {
        await provider.sendText({ phone: cleanPhone, message });
      }
    }

    await db.from("crm_campaign_events")
      .insert({
        organization_id: orgId,
        campaign_id: campaignId,
        event_type: "campaign_test_sent",
        payload: { phone: cleanPhone, step_count: steps.length },
      });

    return;
  } catch (err) {
    return { error: asErr(err, "Não foi possível enviar o teste.") };
  }
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function computeStepSendAt(step: Record<string, unknown>, baseNow: Date, previousSendAt: Date): Date {
  const mode = step.send_mode as string;

  if (mode === "scheduled_at" && step.scheduled_at) {
    const scheduled = new Date(step.scheduled_at as string);
    // Se data no passado, usa agora
    if (scheduled.getTime() > baseNow.getTime()) return scheduled;
  }

  if (mode === "delay_after_previous" && step.delay_amount && step.delay_unit) {
    const amount = step.delay_amount as number;
    const unit = step.delay_unit as string;
    const ms = unit === "minutes" ? amount * 60_000
              : unit === "hours"   ? amount * 3_600_000
              : /* days */            amount * 86_400_000;
    return new Date(previousSendAt.getTime() + ms);
  }

  // immediate ou fallback
  return baseNow;
}

function interpolateCampaignTestText(
  template: string | null,
  recipient: { display_name: string; phone: string; chat_jid: string | null },
): string | null {
  if (!template) return null;
  const name = recipient.display_name.trim();
  const firstName = name.split(/\s+/).filter(Boolean)[0] ?? "";
  return template
    .replaceAll("{{nome}}", name)
    .replaceAll("{{primeiro_nome}}", firstName)
    .replaceAll("{{telefone}}", recipient.phone);
}

