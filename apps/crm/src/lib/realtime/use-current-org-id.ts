"use client";

// PR-O: helper compartilhado pelos hooks de realtime que precisam do
// orgId no filter postgres_changes. Resolve `organization_id` do
// membro logado via supabase auth + organization_members.
//
// Cache em memoria por sessao do client (uma vez so por mount).
// Se o user troca de org (raro hoje, mas possivel via switch), o
// componente que usa o hook precisa remontar — aceitavel pra v1.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useCurrentOrgId(): string | null {
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: member } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (member && !cancelled) setOrgId(member.organization_id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return orgId;
}
