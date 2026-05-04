import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logError, logInfo, logWarn, errorMessage } from "@/lib/observability";
import { flushReadyConversations } from "@/lib/ai-agent/debounce";
import { asAgentDb } from "@/lib/ai-agent/db";
import { createAdminClient } from "@/lib/supabase/admin";

function secretsMatch(expected: string, received: string | null): boolean {
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const expectedSecret = process.env.PERSIA_DEBOUNCE_FLUSH_SECRET;

  if (!expectedSecret) {
    logWarn("ai_agent_debounce_flush_secret_missing", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/debounce-flush",
    });
    return NextResponse.json({ ok: false, error: "flush_secret_missing" }, { status: 503 });
  }

  if (!secretsMatch(expectedSecret, request.headers.get("X-Persia-Cron-Secret"))) {
    logWarn("ai_agent_debounce_flush_secret_mismatch", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/debounce-flush",
    });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // PR-AGENT1 — Early-return probe.
  // Antes: cada tick (15s) chamava flushReadyConversations -> 1 SELECT na
  // agent_conversations + (no caso comum) zero claims + log de "fiz nada".
  // Mesmo o caminho "feliz vazio" custava 1 query + 1 log por tick.
  //
  // Agora: faz um head() apontando pro índice parcial
  // `idx_agent_conversations_next_flush_unclaimed`. Se vier vazio, responde
  // { idle: true } sem logar nem ir adiante. Custo do tick ocioso = 1 lookup
  // em índice de tamanho proporcional só ao número de conversas com debounce
  // pendente (zero na maior parte do tempo) → praticamente grátis.
  const adminClient = createAdminClient();
  const probeDb = asAgentDb(adminClient);
  const nowIso = new Date().toISOString();
  const { count: pendingCount, error: probeError } = await probeDb
    .from("agent_conversations")
    .select("id", { count: "exact", head: true })
    .lte("next_flush_at", nowIso)
    .is("flush_claimed_at", null)
    .limit(1);

  if (probeError) {
    logError("ai_agent_debounce_flush_probe_failed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/debounce-flush",
      error: probeError.message,
    });
    return NextResponse.json(
      {
        flushed_conversations: 0,
        runs_created: 0,
        errors: 1,
        details: [],
      },
      { status: 200 },
    );
  }

  if (!pendingCount || pendingCount === 0) {
    // Tick ocioso. Não loga (evita poluir Logs Explorer com 5.7k linhas/dia
    // de "nada a fazer"). Não chama flushReadyConversations (poupa queries).
    return NextResponse.json({
      flushed_conversations: 0,
      runs_created: 0,
      errors: 0,
      idle: true,
    });
  }

  try {
    const result = await flushReadyConversations({
      db: probeDb,
      requestId,
    });

    logInfo("ai_agent_debounce_flush_completed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/debounce-flush",
      flushed_conversations: result.flushed_conversations,
      runs_created: result.runs_created,
      errors: result.errors,
    });

    return NextResponse.json(result);
  } catch (error) {
    logError("ai_agent_debounce_flush_failed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/debounce-flush",
      error: errorMessage(error),
    });
    return NextResponse.json(
      {
        flushed_conversations: 0,
        runs_created: 0,
        errors: 1,
        details: [],
      },
      { status: 200 },
    );
  }
}
