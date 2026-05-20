"use server";

// Google Calendar — server actions.
//
// PR-FLOW-PIVOT PR 14a (mai/2026): foundation. UI consome essas
// actions pra mostrar status, iniciar OAuth, listar/escolher calendar
// default e desconectar.
//
// Não toca em create_appointment ainda — PR 14b fará migração do
// handler interno pra Google Calendar API quando feature flag ativa.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { errorMessage } from "@/lib/observability";
import { asAgentDb } from "@/lib/ai-agent/db";
import {
  listCalendars,
  type GoogleCalendarConnection,
  type GoogleCalendarSummary,
} from "@/lib/google-calendar/api";
import { getGoogleOAuthEnv } from "@/lib/google-calendar/oauth";

// ============================================================================
// Read: status
// ============================================================================

export interface GoogleCalendarStatus {
  configured: boolean; // env vars presentes no servidor
  connected: boolean; // tem row em google_calendar_connections + is_active
  account_email: string | null;
  default_calendar_id: string | null;
  calendar_list: GoogleCalendarSummary[];
  connected_at: string | null;
  /** PR 14c (mai/2026): última execução do pull sync Google → CRM. */
  last_polled_at: string | null;
  error?: string;
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  // 1. Check env config primeiro — se faltar, UI mostra mensagem clara.
  let configured = false;
  try {
    getGoogleOAuthEnv();
    configured = true;
  } catch {
    configured = false;
  }

  if (!configured) {
    return {
      configured: false,
      connected: false,
      account_email: null,
      default_calendar_id: null,
      calendar_list: [],
      connected_at: null,
      last_polled_at: null,
    };
  }

  // 2. Tenta carregar a conexão da org.
  try {
    const { supabase, orgId } = await requireRole("agent");
    const { data, error } = await asAgentDb(supabase)
      .from("google_calendar_connections")
      .select(
        "google_account_email, default_calendar_id, calendar_list, is_active, created_at, last_polled_at",
      )
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) {
      // Tabela faltando (migration 059 não rodou) — trata como "não
      // conectado" + log.
      const msg = error.message ?? "";
      if (
        /relation .*google_calendar_connections.* does not exist/i.test(msg) ||
        /could not find the table/i.test(msg) ||
        msg.includes("PGRST205")
      ) {
        return {
          configured: true,
          connected: false,
          account_email: null,
          default_calendar_id: null,
          calendar_list: [],
          connected_at: null,
          last_polled_at: null,
          error: "Migration 059 pendente — aplique no SQL Editor.",
        };
      }
      throw new Error(msg);
    }

    if (!data || !(data as { is_active?: boolean }).is_active) {
      return {
        configured: true,
        connected: false,
        account_email: null,
        default_calendar_id: null,
        calendar_list: [],
        connected_at: null,
        last_polled_at: null,
      };
    }

    const row = data as {
      google_account_email: string;
      default_calendar_id: string | null;
      calendar_list: unknown;
      created_at: string;
      last_polled_at: string | null;
    };

    return {
      configured: true,
      connected: true,
      account_email: row.google_account_email,
      default_calendar_id: row.default_calendar_id,
      calendar_list: Array.isArray(row.calendar_list)
        ? (row.calendar_list as GoogleCalendarSummary[])
        : [],
      connected_at: row.created_at,
      last_polled_at: row.last_polled_at,
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      account_email: null,
      default_calendar_id: null,
      calendar_list: [],
      connected_at: null,
      last_polled_at: null,
      error: errorMessage(err),
    };
  }
}

// ============================================================================
// Write: refresh calendar list
// ============================================================================

/**
 * Pega a lista atual de calendars do Google + persiste em
 * `calendar_list`. Usado quando cliente clica "Atualizar lista" na UI
 * (ex: criou novo calendar no Google e quer ver aqui).
 */
export async function refreshGoogleCalendarList(): Promise<{
  ok: boolean;
  count?: number;
  error?: string;
}> {
  try {
    const { supabase, orgId } = await requireRole("admin");
    const { data, error } = await asAgentDb(supabase)
      .from("google_calendar_connections")
      .select(
        "organization_id, google_account_email, refresh_token, access_token, access_token_expires_at, default_calendar_id, calendar_list, scope, is_active",
      )
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error || !data) {
      return { ok: false, error: "Conta Google Calendar não conectada." };
    }
    const conn = data as GoogleCalendarConnection;
    if (!conn.is_active) {
      return { ok: false, error: "Conexão desativada — reconecte." };
    }

    const calendars = await listCalendars(supabase, conn);

    await asAgentDb(supabase)
      .from("google_calendar_connections")
      .update({ calendar_list: calendars })
      .eq("organization_id", orgId);

    revalidatePath("/settings/google-calendar");
    return { ok: true, count: calendars.length };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ============================================================================
// Write: set default calendar
// ============================================================================

export async function setGoogleCalendarDefault(
  calendarId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!calendarId || typeof calendarId !== "string") {
    return { ok: false, error: "calendarId inválido" };
  }
  try {
    const { supabase, orgId } = await requireRole("admin");
    const { error } = await asAgentDb(supabase)
      .from("google_calendar_connections")
      .update({ default_calendar_id: calendarId })
      .eq("organization_id", orgId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings/google-calendar");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ============================================================================
// Write: disconnect
// ============================================================================

/**
 * V1: hard delete da row. V2 pode preservar histórico com `is_active=false`
 * + cleanup cron. Pra foundation, delete simples basta.
 */
export async function disconnectGoogleCalendar(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const { supabase, orgId } = await requireRole("admin");
    const { error } = await asAgentDb(supabase)
      .from("google_calendar_connections")
      .delete()
      .eq("organization_id", orgId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings/google-calendar");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
