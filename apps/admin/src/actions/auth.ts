"use server";

import { createClient } from "@/lib/supabase-server";
import { clearAdminContext } from "@/lib/admin-context";
import { redirect } from "next/navigation";

export async function signOut() {
  const supabase = await createClient();
  await clearAdminContext();
  await supabase.auth.signOut();
  redirect("/login");
}
