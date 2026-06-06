export const metadata = { title: "Dashboard" };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { LeadsByMonthChart } from "@/components/dashboard/leads-by-month-chart";
import {
  Users,
  TrendingUp,
  DollarSign,
  BarChart3,
  MessageSquare,
  Clock,
  Target,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { PageTitle } from "@persia/ui/typography";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
        <p className="text-sm text-muted-foreground">
          Nenhuma organização encontrada.{" "}
          <a href="/register" className="text-primary underline">
            Criar conta
          </a>
        </p>
      </div>
    );
  }

  const orgId = member.organization_id;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixMonthsAgo = new Date(now.getTime() - 182 * 24 * 60 * 60 * 1000).toISOString();

  // Todas as queries em paralelo
  const [
    totalLeadsRes,
    newLeads30dRes,
    wonDealsMonthRes,
    wonCountRes,
    lostCountRes,
    openConvsRes,
    waitingRes,
    recentLeadsRes,
    sourceLeadsRes,
    pipelinesRes,
    leadsWithStageRes,
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", thirtyDaysAgo),
    // Receita do mês: deals won com closed_at no mês atual
    supabase
      .from("deals")
      .select("value")
      .eq("organization_id", orgId)
      .eq("status", "won")
      .gte("closed_at", monthStart),
    supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "won"),
    supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "lost"),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .neq("status", "closed"),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "waiting_human"),
    // Leads por mês (últimos 6 meses)
    supabase
      .from("leads")
      .select("created_at")
      .eq("organization_id", orgId)
      .gte("created_at", sixMonthsAgo),
    // Origens últimos 30 dias
    supabase
      .from("leads")
      .select("source")
      .eq("organization_id", orgId)
      .gte("created_at", thirtyDaysAgo),
    // Pipeline principal + stages
    supabase
      .from("pipelines")
      .select("id, name, pipeline_stages(id, name, color)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true })
      .limit(1),
    // Leads por etapa
    supabase
      .from("leads")
      .select("stage_id")
      .eq("organization_id", orgId)
      .not("stage_id", "is", null),
  ]);

  // Receita do mês
  const revenueThisMonth = (wonDealsMonthRes.data ?? []).reduce(
    (acc, d) => acc + (Number((d as { value?: unknown }).value) || 0),
    0,
  );
  const wonCount = wonCountRes.count ?? 0;
  const lostCount = lostCountRes.count ?? 0;
  const closedDeals = wonCount + lostCount;
  const conversionRate = closedDeals > 0 ? Math.round((wonCount / closedDeals) * 100) : 0;

  // Leads por mês (últimos 6)
  const MONTH_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const monthMap = new Map<string, number>();
  for (const l of (recentLeadsRes.data ?? []) as { created_at: string }[]) {
    const d = new Date(l.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthMap.set(key, (monthMap.get(key) ?? 0) + 1);
  }
  const leadsByMonth = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (5 - i));
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    return { month: MONTH_LABELS[d.getMonth()], leads: monthMap.get(key) ?? 0 };
  });

  // Origens — top 5
  const sourceCounts: Record<string, number> = {};
  for (const l of (sourceLeadsRes.data ?? []) as { source: string }[]) {
    const s = l.source || "Desconhecida";
    sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
  }
  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const maxSourceCount = topSources[0]?.[1] ?? 1;

  // Funil — leads por etapa
  type Stage = { id: string; name: string; color: string | null };
  const mainPipeline = (pipelinesRes.data ?? [])[0] as
    | { name: string; pipeline_stages: Stage[] }
    | undefined;
  const stages: Stage[] = mainPipeline?.pipeline_stages ?? [];

  const stageCounts = new Map<string, number>();
  for (const l of (leadsWithStageRes.data ?? []) as { stage_id: string }[]) {
    stageCounts.set(l.stage_id, (stageCounts.get(l.stage_id) ?? 0) + 1);
  }
  const stageRows = stages
    .map((s) => ({ ...s, count: stageCounts.get(s.id) ?? 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxStageCount = stageRows[0]?.count ?? 1;

  const rawDate = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);

  const sourceLabels: Record<string, string> = {
    whatsapp: "WhatsApp",
    manual: "Manual",
    import: "Importação",
    group: "Grupo",
    smart_link: "Smart Link",
    webhook: "Webhook",
    unknown: "Desconhecida",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageTitle size="compact">Dashboard</PageTitle>
          <p className="text-sm text-muted-foreground mt-1">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/crm" className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors">
            <Users className="size-3.5" />
            Leads
          </Link>
          <Link href="/chat" className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors">
            <MessageSquare className="size-3.5" />
            Chat
          </Link>
          <Link href="/agenda" className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors">
            <Clock className="size-3.5" />
            Agenda
          </Link>
        </div>
      </div>

      {/* KPIs — linha 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total de Leads"
          value={(totalLeadsRes.count ?? 0).toLocaleString("pt-BR")}
          icon={Users}
        />
        <KpiCard
          title="Novos (30 dias)"
          value={(newLeads30dRes.count ?? 0).toLocaleString("pt-BR")}
          icon={TrendingUp}
        />
        <KpiCard
          title="Vendas Fechadas"
          value={wonCount.toLocaleString("pt-BR")}
          description="total acumulado"
          icon={Target}
        />
        <KpiCard
          title="Receita do Mês"
          value={
            revenueThisMonth > 0
              ? revenueThisMonth.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
              : "R$ 0"
          }
          icon={DollarSign}
        />
      </div>

      {/* KPIs — linha 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          title="Taxa de Conversão"
          value={`${conversionRate}%`}
          description={closedDeals > 0 ? `${wonCount} ganhos de ${closedDeals} fechados` : "sem negócios fechados"}
          icon={BarChart3}
        />
        <KpiCard
          title="Conversas Abertas"
          value={(openConvsRes.count ?? 0).toLocaleString("pt-BR")}
          icon={MessageSquare}
        />
        {/* Ocupa linha inteira no mobile para dar destaque ao alerta */}
        <div className="col-span-2 lg:col-span-1">
          <KpiCard
            title="Aguardando Humano"
            value={(waitingRes.count ?? 0).toLocaleString("pt-BR")}
            icon={Clock}
            variant={(waitingRes.count ?? 0) > 0 ? "warning" : "default"}
          />
        </div>
      </div>

      {/* Gráficos e análises */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Leads por mês */}
        <Card className="border rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Leads por Mês</CardTitle>
            <p className="text-xs text-muted-foreground">Últimos 6 meses</p>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            <LeadsByMonthChart data={leadsByMonth} />
          </CardContent>
        </Card>

        {/* Origens dos leads */}
        <Card className="border rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Origens dos Leads</CardTitle>
            <p className="text-xs text-muted-foreground">Últimos 30 dias</p>
          </CardHeader>
          <CardContent className="pt-0 pb-4 space-y-3">
            {topSources.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhum lead nos últimos 30 dias</p>
            ) : (
              topSources.map(([source, count], idx) => (
                <div key={source} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{sourceLabels[source] ?? source}</span>
                    <span className="text-muted-foreground tabular-nums">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round((count / maxSourceCount) * 100)}%`,
                        background: `hsl(var(--primary) / ${Math.max(0.35, 1 - idx * 0.13)})`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Funil — leads por etapa */}
      <Card className="border rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            Leads por Etapa
            {mainPipeline && (
              <span className="text-muted-foreground font-normal text-xs ml-2">
                {mainPipeline.name}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          {stageRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {mainPipeline ? "Nenhum lead nas etapas ainda." : "Nenhum funil configurado."}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {stageRows.map((stage) => (
                <div key={stage.id} className="rounded-lg border bg-muted/40 p-3 space-y-1">
                  <div
                    className="size-2 rounded-full mb-2"
                    style={{ background: stage.color ?? "hsl(var(--primary))" }}
                  />
                  <p className="text-xs text-muted-foreground leading-tight">{stage.name}</p>
                  <p className="text-xl font-bold tabular-nums">{stage.count}</p>
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.round((stage.count / maxStageCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
