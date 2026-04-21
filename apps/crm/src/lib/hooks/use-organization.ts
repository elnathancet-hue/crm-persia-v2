"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type Organization = Database["public"]["Tables"]["organizations"]["Row"];
type Member = Database["public"]["Tables"]["organization_members"]["Row"];

export function useOrganization() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: member } = await supabase
        .from("organization_members")
        .select("*, organizations(*)")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .single();

      if (member) {
        setMembership(member);
        setOrganization((member as any).organizations);
      }
      setLoading(false);
    }
    load();
  }, []);

  return { organization, membership, loading };
}
