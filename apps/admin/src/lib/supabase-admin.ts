import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@persia/shared/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Admin client - service_role, bypasses RLS. Server-only.
let adminClient: ReturnType<typeof createClient<Database>> | undefined;

export function getAdmin() {
  if (!adminClient) {
    adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return adminClient;
}
