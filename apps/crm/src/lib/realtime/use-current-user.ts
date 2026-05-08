"use client";

// PR-P: hook pra resolver o user logado (id + full_name) pro track
// de presence. Reutiliza supabase.auth.getUser + JOIN profiles pra
// pegar o full_name (ou fallback "Voce" se profile nao existe).
//
// Cache em memoria por sessao do client. Se trocar de user, o hook
// re-busca via re-mount do componente que usa.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type CurrentUser = {
  user_id: string;
  full_name: string;
};

export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser || cancelled) return;
      // RLS de profiles (PR-L1) permite ler propria linha + linhas
      // da mesma org. Aqui basta a propria.
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
  }, []);

  return user;
}
