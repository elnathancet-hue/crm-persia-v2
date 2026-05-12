"use client";

// PR-U2 (movido de apps/crm/src/lib/realtime, subsume parte do PR-S2):
// hook pra resolver o user logado (id + full_name). Reusa
// supabase.auth.getUser + JOIN profiles pra pegar full_name.
//
// DI: recebe supabase como param. CRM passa createClient() do app;
// admin passa getSupabaseBrowserClient() (que tambem usa cookie).
//
// Re-busca em mudanca do supabase ref — controlled pelo caller.

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CurrentUser = {
  user_id: string;
  full_name: string;
};

export function useCurrentUser(
  supabase: SupabaseClient | null,
): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (!supabase) {
      setUser(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser || cancelled) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", authUser.id)
        .maybeSingle();
      if (cancelled) return;
      setUser({
        user_id: authUser.id,
        full_name:
          (profile?.full_name as string | null | undefined)?.trim() ||
          authUser.email?.split("@")[0] ||
          "Você",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return user;
}
