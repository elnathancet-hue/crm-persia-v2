import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@persia/shared/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser client - singleton, uses cookies automatically
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return browserClient;
}

// Realtime client for admin - uses anon key (authenticated via user session)
// Note: RLS policies must allow superadmin access for realtime to work
let realtimeClient: ReturnType<typeof createClient<Database>> | undefined;

export function getRealtimeClient() {
  if (!realtimeClient) {
    realtimeClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return realtimeClient;
}
