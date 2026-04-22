"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Returns the count of conversations with unread_count > 0 for the current user's org.
 * Subscribes to Realtime for instant updates.
 */
export function useUnreadCount() {
  const [count, setCount] = useState(0);
  const [orgId, setOrgId] = useState<string | null>(null);

  // Get org ID
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

  // Fetch + subscribe
  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();

    async function fetchCount() {
      const { count: unread } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId!)
        .gt("unread_count", 0)
        .neq("status", "closed");
      setCount(unread || 0);
    }

    fetchCount();

    const channel = supabase
      .channel("unread-badge")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchCount();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  return count;
}
