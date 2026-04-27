export const metadata = { title: "Leads" };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLeads } from "@/actions/leads";
import { LeadList } from "@/components/leads/lead-list";

export default async function LeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // .single() explode pra users com 2+ memberships (PGRST116) e
  // disparava redirect /login mesmo com sessao valida. Usa
  // .order().limit(1).maybeSingle() — mesmo padrao do dashboard.
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) {
    redirect("/login");
  }

  const result = await getLeads({ page: 1, limit: 20 });

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6">
      <LeadList
        initialLeads={result.leads}
        initialTotal={result.total}
        initialPage={result.page}
        initialTotalPages={result.totalPages}
      />
    </div>
  );
}
