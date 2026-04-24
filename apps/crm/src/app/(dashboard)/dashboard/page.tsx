export const metadata = { title: "Dashboard" };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MessageSquare, Users, Bot, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Picks the oldest active membership when the user has >1 org.
  // Mirrors pickActiveMembership in @/lib/auth so /dashboard, /, and the auth
  // helpers all converge on the same active org.
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-muted-foreground">Nenhuma organização encontrada. <a href="/register" className="text-primary underline">Criar conta</a></p>
      </div>
    );
  }

  const orgId = member.organization_id;

  // KPIs - all in parallel for performance
  const today = new Date().toISOString().split("T")[0];
  // Server component runs per-request, so Date.now is fine here.
  // eslint-disable-next-line react-hooks/purity
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [convResult, leadsResult, waitingResult] = await Promise.all([
    supabase.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId).gte("created_at", today),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", orgId).gte("created_at", weekAgo),
    supabase.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "waiting_human"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Visao geral do seu CRM</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Conversas Hoje" value={convResult.count ?? 0} icon={MessageSquare} />
        <KpiCard title="Leads Novos (7d)" value={leadsResult.count ?? 0} icon={Users} />
        <KpiCard title="Taxa da IA" value="--" description="Ative a IA para ver" icon={Bot} />
        <KpiCard title="Aguardando Humano" value={waitingResult.count ?? 0} icon={Clock} />
      </div>

      <Card className="border rounded-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold tracking-tight">Bem-vindo ao CRM Persia!</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Seu sistema esta configurado. Use o menu lateral para navegar entre os modulos.
          </p>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/ai" className="block p-6 rounded-xl border bg-card hover:shadow-md hover:border-primary/30 transition-all duration-200 group">
              <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <Bot className="size-5 text-primary" />
              </div>
              <p className="font-medium text-sm">Configurar IA</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Configure seu assistente virtual</p>
            </Link>
            <Link href="/leads" className="block p-6 rounded-xl border bg-card hover:shadow-md hover:border-primary/30 transition-all duration-200 group">
              <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <Users className="size-5 text-primary" />
              </div>
              <p className="font-medium text-sm">Base de Leads</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Gerencie seus contatos</p>
            </Link>
            <Link href="/chat" className="block p-6 rounded-xl border bg-card hover:shadow-md hover:border-primary/30 transition-all duration-200 group">
              <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <MessageSquare className="size-5 text-primary" />
              </div>
              <p className="font-medium text-sm">Chat Live</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Converse com seus leads</p>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
