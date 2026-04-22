import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@persia/shared/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export type AdminClient = SupabaseClient<Database>;

// Singleton — reused across requests within the same Node process.
let adminClient: AdminClient | undefined;

/**
 * Service-role Supabase client. Bypasses RLS — use with care.
 *
 * Internal primitive for this module. Application code should prefer
 * `withAdmin(reason, fn)` or the auth helpers in @/lib/auth so every
 * service-role escalation is named and greppable.
 */
export function getAdmin(): AdminClient {
  if (!adminClient) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "[supabase-admin] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
      );
    }
    adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

/**
 * Encapsulated service-role usage. Prefer this over raw getAdmin() for
 * any sensitive operation — it gives you a single chokepoint to add
 * auditing, tracing, or rate-limits later.
 *
 * The `reason` argument doubles as documentation: grep
 * `withAdmin\("[a-z_]+"` to find every escalation point in the codebase.
 *
 * Example:
 *   const orgs = await withAdmin("list_all_orgs", async (admin) => {
 *     const { data } = await admin.from("organizations").select("id, name");
 *     return data ?? [];
 *   });
 *
 * Errors propagate to the caller (unlike auditLog which is fire-and-forget),
 * so the calling action can decide how to surface them to the UI.
 */
export async function withAdmin<T>(
  reason: string,
  fn: (admin: AdminClient) => Promise<T>
): Promise<T> {
  if (!reason || reason.length < 3) {
    throw new Error("[withAdmin] reason is required (used for audit/trace)");
  }
  const admin = getAdmin();
  // Hook point: future audit/trace integration goes here.
  // Kept silent for now to avoid log spam — switching reason -> auditLog()
  // is a one-line change when we want to enable it per-environment.
  return fn(admin);
}
