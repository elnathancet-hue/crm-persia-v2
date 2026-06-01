"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const LAST_SEEN_KEY = "groups_last_seen_at";

/**
 * Conta mensagens inbound de grupos chegadas desde a última visita a /groups.
 *
 * Segue o mesmo padrão de use-unread-count.ts (Chat):
 *  1. Busca orgId via organization_members
 *  2. Faz query inicial no DB (persiste entre reloads via localStorage)
 *  3. Subscription com filtro organization_id=eq.{orgId} (RLS não bloqueia)
 *  4. Ao entrar em /groups: salva timestamp + zera contagem
 */
export function useGroupsUnreadCount() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [orgId, setOrgId] = useState<string | null>(null);

  // 1. Resolve orgId
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: member } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (member) setOrgId(member.organization_id);
    })();
  }, []);

  // 2. Reset ao entrar em /groups (GroupsClient salva o timestamp no unmount)
  useEffect(() => {
    if (pathname === "/groups" || pathname.startsWith("/groups/")) {
      setCount(0);
    }
  }, [pathname]);

  // 3. Busca inicial + subscription (depende do orgId)
  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();

    async function fetchCount() {
      const lastSeen = localStorage.getItem(LAST_SEEN_KEY) ?? new Date(0).toISOString();
      const { count: unread } = await (supabase as any)
        .from("group_messages")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("direction", "inbound")
        .eq("is_deleted", false)
        .gt("created_at", lastSeen);
      setCount(unread ?? 0);
    }

    fetchCount();

    const channel = supabase
      .channel("groups-sidebar-badge")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload: { new: { direction: string } }) => {
          if (payload.new.direction === "inbound") {
            setCount((c) => c + 1);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  return count;
}
