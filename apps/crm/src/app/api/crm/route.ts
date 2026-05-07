import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { moveDealToStage } from "@/lib/crm/move-deal";
import { phoneBROptional, leadUpdateSchema } from "@persia/shared/validation";
import { revalidateLeadCaches } from "@/lib/cache/lead-revalidation";

/**
 * CRM API - Used by n8n AI Agent to control the CRM pipeline
 *
 * Actions:
 * - move_deal: Move lead to a pipeline stage (idempotent, logs activity, triggers flows)
 * - add_tag: Add tag to lead
 * - remove_tag: Remove tag from lead
 * - pause_bot: Pause AI bot for a lead
 * - get_lead: Get lead info
 * - get_deal: Get current deal + stage for a lead
 * - list_stages: List pipeline stages for an org
 * - update_lead: Update lead data
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate: require Bearer token matching CRM_API_SECRET
    const authHeader = request.headers.get("authorization");
    const apiSecret = process.env.CRM_API_SECRET;
    if (!apiSecret || authHeader !== `Bearer ${apiSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action, orgId, leadId, phone } = body;

    if (!action) {
      return NextResponse.json({ error: "action required" }, { status: 400 });
    }

    const supabase = getSupabase();

    // Resolve lead by phone if leadId not provided
    let resolvedLeadId = leadId;
    let resolvedOrgId = orgId;

    if (!resolvedLeadId && phone) {
      // PR-A LEADFIX: normaliza phone via Zod (E.164) antes de
      // lookup. Resolve duplicidade entre formatos diferentes
      // (ex: "11987654321" vs "+5511987654321"). Se phone vier
      // malformado, phoneBROptional retorna undefined e o lookup
      // simplesmente falha — n8n recebe lead not found.
      const phoneResult = phoneBROptional.safeParse(phone);
      const normalizedPhone = phoneResult.success ? phoneResult.data : undefined;

      if (normalizedPhone) {
        const { data: lead } = await supabase
          .from("leads")
          .select("id, organization_id")
          .eq("phone", normalizedPhone)
          .limit(1)
          .single();

        if (lead) {
          resolvedLeadId = lead.id;
          if (!resolvedOrgId) resolvedOrgId = lead.organization_id;
        }
      }
    }

    // Actions that don't require a lead
    if (action === "list_stages") {
      if (!resolvedOrgId) {
        return NextResponse.json({ error: "orgId required for list_stages" }, { status: 400 });
      }

      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("id, name, sort_order, color, pipeline_id, pipelines(id, name)")
        .eq("organization_id", resolvedOrgId)
        .order("sort_order", { ascending: true });

      return NextResponse.json({
        ok: true,
        stages: (stages || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          sort_order: s.sort_order,
          color: s.color,
          pipeline: s.pipelines?.name || null,
          pipeline_id: s.pipeline_id,
        })),
      });
    }

    if (!resolvedLeadId) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }

    switch (action) {
      // ============ MOVE DEAL ============
      case "move_deal": {
        const { stageId, stageName, pipelineId, reason } = body;

        // Resolve stage by name if stageId not provided
        let targetStageId = stageId;
        if (!targetStageId && stageName && resolvedOrgId) {
          const { data: stage } = await supabase
            .from("pipeline_stages")
            .select("id")
            .eq("organization_id", resolvedOrgId)
            .ilike("name", stageName)
            .limit(1)
            .single();

          if (stage) targetStageId = stage.id;
        }

        if (!targetStageId) {
          return NextResponse.json({ error: "stage not found" }, { status: 404 });
        }

        // Find or create deal for this lead
        let { data: deal } = await supabase
          .from("deals")
          .select("id")
          .eq("lead_id", resolvedLeadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!deal) {
          // Auto-create deal — get pipeline_id from target stage
          const { data: targetStage } = await supabase
            .from("pipeline_stages")
            .select("pipeline_id")
            .eq("id", targetStageId)
            .single();

          const { data: lead } = await supabase
            .from("leads")
            .select("name, organization_id")
            .eq("id", resolvedLeadId)
            .single();

          const { data: newDeal } = await supabase.from("deals").insert({
            organization_id: lead?.organization_id || resolvedOrgId,
            pipeline_id: targetStage?.pipeline_id || pipelineId,
            lead_id: resolvedLeadId,
            stage_id: targetStageId,
            title: `${lead?.name || "Lead"} - Negocio`,
            value: 0,
            status: "open",
          }).select("id").single();

          deal = newDeal;
        }

        if (!deal) {
          return NextResponse.json({ error: "failed to find or create deal" }, { status: 500 });
        }

        // Use shared moveDealToStage — handles idempotency, activity log, triggers, sync
        const result = await moveDealToStage({
          dealId: deal.id,
          stageId: targetStageId,
          orgId: resolvedOrgId,
          source: "automation",
          reason,
        });

        // PR-K LEAD-SYNC: invalida caches /crm + /leads + /leads/:id
        // pra Tab Leads refletir que o deal mudou (e potencialmente o
        // status do lead). Sem isso, n8n move o deal mas user nao ve.
        await revalidateLeadCaches(resolvedLeadId);

        return NextResponse.json({
          ok: result.ok,
          action: "move_deal",
          noop: result.noop || false,
          stageId: targetStageId,
          fromStage: result.fromStage,
          toStage: result.toStage,
          ...(result.error ? { error: result.error } : {}),
        });
      }

      // ============ ADD TAG ============
      case "add_tag": {
        const { tagName } = body;
        if (!tagName) return NextResponse.json({ error: "tagName required" }, { status: 400 });

        // Find or create tag
        let { data: tag } = await supabase
          .from("tags")
          .select("id")
          .eq("organization_id", resolvedOrgId)
          .ilike("name", tagName)
          .limit(1)
          .single();

        if (!tag) {
          const { data: newTag } = await supabase
            .from("tags")
            .insert({ organization_id: resolvedOrgId, name: tagName, color: "#3b82f6" })
            .select("id")
            .single();
          tag = newTag;
        }

        if (tag) {
          await supabase
            .from("lead_tags")
            .upsert({ lead_id: resolvedLeadId, tag_id: tag.id }, { onConflict: "lead_id,tag_id" });
        }

        // PR-K LEAD-SYNC: tag adicionada via n8n -> tab Leads precisa
        // refletir nas chips do lead (LeadsList renderiza tags inline).
        await revalidateLeadCaches(resolvedLeadId);

        return NextResponse.json({ ok: true, action: "add_tag", tagName });
      }

      // ============ REMOVE TAG ============
      case "remove_tag": {
        const { tagName: removeTagName } = body;
        if (!removeTagName) return NextResponse.json({ error: "tagName required" }, { status: 400 });

        const { data: existingTag } = await supabase
          .from("tags")
          .select("id")
          .eq("organization_id", resolvedOrgId)
          .ilike("name", removeTagName)
          .limit(1)
          .single();

        if (existingTag) {
          await supabase
            .from("lead_tags")
            .delete()
            .eq("lead_id", resolvedLeadId)
            .eq("tag_id", existingTag.id);
        }

        // PR-K LEAD-SYNC: tag removida via n8n -> tab Leads atualiza
        await revalidateLeadCaches(resolvedLeadId);

        return NextResponse.json({ ok: true, action: "remove_tag" });
      }

      // ============ PAUSE BOT ============
      case "pause_bot": {
        const { minutes = 480 } = body;

        // Update conversation to waiting_human
        await supabase
          .from("conversations")
          .update({ assigned_to: "waiting_human", status: "waiting_human" })
          .eq("lead_id", resolvedLeadId)
          .eq("status", "active");

        // Sync with UAZAPI if connected
        try {
          const { disableChatbotForLead } = await import("@/lib/whatsapp/sync");
          const { data: lead } = await supabase
            .from("leads")
            .select("phone, organization_id")
            .eq("id", resolvedLeadId)
            .single();

          if (lead?.phone) {
            await disableChatbotForLead(lead.organization_id, lead.phone, minutes);
          }
        } catch {}

        // PR-K LEAD-SYNC: bot pausado afeta status do lead na lista
        // (indicador "AI ativo / pausado" — disponivel no drawer)
        await revalidateLeadCaches(resolvedLeadId);

        return NextResponse.json({ ok: true, action: "pause_bot", minutes });
      }

      // ============ GET LEAD ============
      case "get_lead": {
        const { data: lead } = await supabase
          .from("leads")
          .select("*")
          .eq("id", resolvedLeadId)
          .single();

        return NextResponse.json({ ok: true, lead });
      }

      // ============ UPDATE LEAD ============
      case "update_lead": {
        // PR-A LEADFIX: payload validado via Zod centralizado.
        // Garante phone E.164, email RFC, score 0-100 etc.
        const parsed = leadUpdateSchema.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json(
            {
              error: "Payload inválido",
              issues: parsed.error.issues.map((i) => ({
                field: i.path.join("."),
                message: i.message,
              })),
            },
            { status: 400 },
          );
        }
        const { name, email, phone, status, score } = parsed.data;
        const updates: Record<string, unknown> = {};
        if (name) updates.name = name;
        if (email) updates.email = email;
        if (phone) updates.phone = phone;
        if (status) updates.status = status;
        if (score !== undefined) updates.score = score;
        updates.updated_at = new Date().toISOString();

        await supabase.from("leads").update(updates).eq("id", resolvedLeadId);

        // PR-K LEAD-SYNC: update via n8n precisa refletir na tab Leads
        // imediatamente (mudanca de status / nome / etc).
        await revalidateLeadCaches(resolvedLeadId);

        return NextResponse.json({ ok: true, action: "update_lead" });
      }

      // ============ GET DEAL ============
      case "get_deal": {
        const { data: deal } = await supabase
          .from("deals")
          .select("id, title, value, status, stage_id, pipeline_id, pipeline_stages(id, name, sort_order, color), pipelines(id, name)")
          .eq("lead_id", resolvedLeadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!deal) {
          return NextResponse.json({ ok: true, deal: null, message: "No deal for this lead" });
        }

        return NextResponse.json({
          ok: true,
          deal: {
            id: deal.id,
            title: deal.title,
            value: deal.value,
            status: deal.status,
            stage: (deal as any).pipeline_stages,
            pipeline: (deal as any).pipelines,
          },
        });
      }

      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "crm-persia-api",
    actions: ["move_deal", "add_tag", "remove_tag", "pause_bot", "get_lead", "get_deal", "list_stages", "update_lead"],
  });
}
