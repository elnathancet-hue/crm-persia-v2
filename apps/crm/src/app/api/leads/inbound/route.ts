// POST /api/leads/inbound
//
// Endpoint público para captura de leads via formulários externos
// (sites, landing pages, ads, parceiros). Autenticado via x-api-key
// (SHA-256 armazenado — nunca a chave em claro).
//
// Fluxo:
//   1. Auth: hash x-api-key → lookup + rate limit atômico via RPC
//   2. Validação Zod do body
//   3. Honeypot anti-bot (campo _honeypot deve estar vazio)
//   4. Validar source_id pertence à chave
//   5. Idempotência: se idempotency_key já visto → replay resposta
//   6. Dedup por telefone dentro da janela configurada
//   7. INSERT lead com UTMs + capture_source_id
//   8. Atribuir pipeline/stage se fonte configurada
//   9. Aplicar tags automáticas
//  10. Disparar flows onNewLead (fire-and-forget)
//  11. Retornar { id, status: "created" | "deduplicated" }
//
// CORS: Access-Control-Allow-Origin: * (script roda em domínios externos)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";
import { phoneBR } from "@persia/shared/validation";
import { onNewLead } from "@/lib/flows/triggers";
import { dispatchWebhook } from "@/lib/webhooks/dispatcher";

// ============================================================================
// CORS
// ============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  "Access-Control-Max-Age": "86400",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

// ============================================================================
// Validation
// ============================================================================

const BodySchema = z.object({
  source_id: z.string().uuid("source_id deve ser um UUID válido"),
  name: z.string().min(1).max(200).optional(),
  // Phone em qualquer formato — normalizamos pra E.164 internamente
  phone: z.string().max(30).optional(),
  email: z.string().email("email inválido").max(200).optional(),
  // Campos extras do formulário (vão pro metadata do lead)
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  // UTMs capturados pelo script embed no pageload
  utm_source: z.string().max(100).optional(),
  utm_medium: z.string().max(100).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_term: z.string().max(200).optional(),
  utm_content: z.string().max(200).optional(),
  // Contexto da página
  page_url: z.string().url().max(500).optional(),
  referrer: z.string().max(500).optional(),
  // Honeypot anti-bot: deve estar ausente ou vazio
  _honeypot: z.string().max(0, "Submissão inválida").optional(),
  // Idempotência: key única por submit (ex: UUID gerado no frontend)
  idempotency_key: z.string().max(100).optional(),
});

type Body = z.infer<typeof BodySchema>;

// ============================================================================
// DB client (service role — bypassa RLS pra escrita pública)
// ============================================================================

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ============================================================================
// Tipos internos
// ============================================================================

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  key_id?: string;
  organization_id?: string;
  requests_this_hour?: number;
  rate_limit_per_hour?: number;
}

interface CaptureSource {
  id: string;
  organization_id: string;
  pipeline_id: string | null;
  stage_id: string | null;
  tag_ids: string[];
  dedup_window_hours: number;
}

// ============================================================================
// POST /api/leads/inbound
// ============================================================================

export async function POST(request: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. Autenticação: x-api-key → SHA-256 → consume_api_key_rate_limit
  // -------------------------------------------------------------------------
  const apiKeyRaw = request.headers.get("x-api-key");
  if (!apiKeyRaw) {
    return json({ error: "Missing x-api-key header" }, 401);
  }

  const keyHash = createHash("sha256").update(apiKeyRaw).digest("hex");
  const db = getDb();

  const { data: rlRaw, error: rlError } = await db.rpc(
    "consume_api_key_rate_limit",
    { p_key_hash: keyHash },
  );

  if (rlError || !rlRaw) {
    console.error("[inbound] rate_limit RPC error:", rlError?.message);
    return json({ error: "Service unavailable" }, 503);
  }

  const rl = rlRaw as RateLimitResult;

  if (!rl.allowed) {
    if (rl.reason === "key_not_found" || rl.reason === "key_inactive") {
      return json({ error: "Invalid API key" }, 401);
    }
    return json(
      {
        error: "Rate limit exceeded",
        limit: rl.rate_limit_per_hour,
        requests_this_hour: rl.requests_this_hour,
        retry_after_seconds: 3600,
      },
      429,
    );
  }

  const orgId = rl.organization_id!;
  const keyId = rl.key_id!;

  // -------------------------------------------------------------------------
  // 2. Parse + validação do body
  // -------------------------------------------------------------------------
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return json(
      {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const body: Body = parsed.data;

  // -------------------------------------------------------------------------
  // 3. Honeypot anti-bot
  // Resposta deliberadamente ambígua: bot não sabe se foi detectado.
  // -------------------------------------------------------------------------
  if (body._honeypot) {
    return json({ id: null, status: "created" }, 201);
  }

  // Pelo menos um campo de identidade é obrigatório
  if (!body.name && !body.phone && !body.email) {
    return json(
      { error: "At least one of name, phone, or email is required" },
      400,
    );
  }

  // -------------------------------------------------------------------------
  // 4. Validar source_id pertence a esta chave + buscar config de roteamento
  // -------------------------------------------------------------------------
  const { data: sourceRaw, error: sourceError } = await db
    .from("capture_sources")
    .select(
      "id, organization_id, pipeline_id, stage_id, tag_ids, dedup_window_hours",
    )
    .eq("id", body.source_id)
    .eq("api_key_id", keyId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (sourceError || !sourceRaw) {
    return json({ error: "Invalid source_id for this API key" }, 403);
  }

  const source = sourceRaw as CaptureSource;

  // -------------------------------------------------------------------------
  // 5. Idempotência: se já processamos esta key → replay da resposta original
  // -------------------------------------------------------------------------
  if (body.idempotency_key) {
    const { data: existingReq } = await db
      .from("inbound_requests")
      .select("response_body")
      .eq("organization_id", orgId)
      .eq("idempotency_key", body.idempotency_key)
      .maybeSingle();

    if (existingReq?.response_body) {
      return json(existingReq.response_body, 200);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Normalizar telefone (E.164). Falha graciosamente com raw.
  // -------------------------------------------------------------------------
  let phone: string | null = body.phone?.trim() || null;
  if (phone) {
    try {
      phone = phoneBR.parse(phone);
    } catch {
      // Formato inválido — mantemos o raw pra não perder o lead.
      // Agente verá o phone estranho e pode corrigir manualmente.
    }
  }

  // -------------------------------------------------------------------------
  // 7. Dedup por telefone dentro da janela configurada
  // -------------------------------------------------------------------------
  if (phone && source.dedup_window_hours > 0) {
    const windowStart = new Date(
      Date.now() - source.dedup_window_hours * 60 * 60 * 1000,
    ).toISOString();

    const { data: dupLead } = await db
      .from("leads")
      .select("id")
      .eq("organization_id", orgId)
      .eq("phone", phone)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dupLead) {
      const responseBody = { id: dupLead.id, status: "deduplicated" };
      if (body.idempotency_key) {
        void db
          .from("inbound_requests")
          .insert({
            organization_id: orgId,
            idempotency_key: body.idempotency_key,
            lead_id: dupLead.id,
            status: "deduplicated",
            response_body: responseBody,
          })
          .then(({ error }) => {
            if (error) console.error("[inbound] idempotency log (dedup) error:", error.message);
          });
      }
      return json(responseBody, 200);
    }
  }

  // -------------------------------------------------------------------------
  // 8. INSERT lead
  // -------------------------------------------------------------------------
  const leadName =
    body.name?.trim() ||
    (phone ? phone : null) ||
    body.email ||
    "Lead sem nome";

  const leadMetadata: Record<string, unknown> = {};
  if (body.custom_fields) Object.assign(leadMetadata, body.custom_fields);
  if (body.page_url) leadMetadata.page_url = body.page_url;
  if (body.referrer) leadMetadata.referrer = body.referrer;

  const { data: lead, error: leadError } = await db
    .from("leads")
    .insert({
      organization_id: orgId,
      name: leadName,
      phone,
      email: body.email || null,
      source: "capture_api",
      status: "new",
      channel: "web",
      capture_source_id: source.id,
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      utm_campaign: body.utm_campaign || null,
      utm_term: body.utm_term || null,
      utm_content: body.utm_content || null,
      metadata: Object.keys(leadMetadata).length > 0 ? leadMetadata : {},
    })
    .select("id")
    .single();

  if (leadError) {
    // Race condition: outro request criou lead com mesmo phone antes de nós.
    // Resolve pra dedup gracioso em vez de 500.
    if (leadError.code === "23505" && phone) {
      const { data: raceLead } = await db
        .from("leads")
        .select("id")
        .eq("organization_id", orgId)
        .eq("phone", phone)
        .maybeSingle();

      if (raceLead) {
        return json({ id: raceLead.id, status: "deduplicated" }, 200);
      }
    }
    console.error("[inbound] lead insert error:", leadError.message, leadError.code);
    return json({ error: "Failed to create lead" }, 500);
  }

  const leadId = lead.id;

  // -------------------------------------------------------------------------
  // 9. Atribuir pipeline/stage se fonte tem config de roteamento
  // -------------------------------------------------------------------------
  if (source.pipeline_id) {
    let stageId = source.stage_id;

    // Se pipeline configurado mas stage não: usa o primeiro stage do pipeline
    if (!stageId) {
      const { data: firstStage } = await db
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", source.pipeline_id)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();
      stageId = firstStage?.id ?? null;
    }

    const { error: pipelineErr } = await db
      .from("leads")
      .update({ pipeline_id: source.pipeline_id, stage_id: stageId })
      .eq("id", leadId);

    if (pipelineErr) {
      console.error("[inbound] pipeline assign error:", pipelineErr.message);
    }
  }

  // -------------------------------------------------------------------------
  // 10. Aplicar tags automáticas da fonte
  // -------------------------------------------------------------------------
  const tagIds: string[] = Array.isArray(source.tag_ids) ? source.tag_ids : [];
  if (tagIds.length > 0) {
    const tagRows = tagIds.map((tagId) => ({
      organization_id: orgId,
      lead_id: leadId,
      tag_id: tagId,
    }));
    const { error: tagErr } = await db.from("lead_tags").insert(tagRows);
    if (tagErr) {
      console.error("[inbound] tag apply error:", tagErr.message);
    }
  }

  // -------------------------------------------------------------------------
  // 11. Log de atividade
  // -------------------------------------------------------------------------
  void db
    .from("lead_activities")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      type: "lead_created",
      description: `Lead capturado via API${body.utm_source ? ` (${body.utm_source})` : ""}`,
    })
    .then(({ error }) => {
      if (error) console.error("[inbound] activity log error:", error.message);
    });

  // -------------------------------------------------------------------------
  // 12. Log de idempotência
  // -------------------------------------------------------------------------
  const responseBody = { id: leadId, status: "created" };

  if (body.idempotency_key) {
    void db
      .from("inbound_requests")
      .insert({
        organization_id: orgId,
        idempotency_key: body.idempotency_key,
        lead_id: leadId,
        status: "created",
        response_body: responseBody,
      })
      .then(({ error }) => {
        if (error) console.error("[inbound] idempotency log error:", error.message);
      });
  }

  // -------------------------------------------------------------------------
  // 13. Webhook externo + flows (fire-and-forget — nunca bloqueia resposta)
  // -------------------------------------------------------------------------
  void dispatchWebhook(orgId, "lead.created", {
    lead: { id: leadId, name: leadName, phone, email: body.email ?? null },
    source: "capture_api",
    capture_source_id: source.id,
  });

  onNewLead(orgId, leadId).catch((err: unknown) => {
    console.error(
      "[inbound] onNewLead error:",
      err instanceof Error ? err.message : String(err),
    );
  });

  return json(responseBody, 201);
}
