export const metadata = { title: "Dashboard" };

import { createClient } from "@/lib/supabase/server";
import { listOrgActivities } from "@persia/shared/crm";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { LeadsByMonthChart } from "@/components/dashboard/leads-by-month-chart";
import { PeriodSelector, type PeriodValue } from "@/components/dashboard/period-selector";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import {
  Users,
  TrendingUp,
  DollarSign,
  BarChart3,
  MessageSquare,
  Clock,
  Target,
  UserX,
  UserMinus,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { PageTitle } from "@persia/ui/typography";

// ─── Period helpers ───────────────────────────────────────────────────────────

function parsePeriod(raw: string | undefined): PeriodValue {
  if (raw === "today" || raw === "week" || raw === "month" || raw === "30d") return raw;
  return "month";
}

function getPeriodRanges(period: PeriodValue, now: Date) {
  let start: Date;
  let prevStart: Date;
  let prevEnd: Date;

  switch (period) {
    case "today": {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      prevStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      prevEnd = new Date(start.getTime() - 1);
      break;
    }
    case "week": {
      const dow = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon = 0
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
      prevStart = new Date(start.getTime() - 7 * 86_400_000);
      prevEnd = new Date(start.getTime() - 1);
      break;
    }
    case "month": {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      prevEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;
    }
    default: {
      // 30d
      start = new Date(now.getTime() - 30 * 86_400_000);
      prevStart = new Date(now.getTime() - 60 * 86_400_000);
      prevEnd = new Date(start.getTime() - 1);
      break;
    }
  }

  return {
    start: start.toISOString(),
    prevStart: prevStart.toISOString(),
    prevEnd: prevEnd.toISOString(),
  };
}

function calcTrend(
  current: number,
  previous: number,
): { value: number; positive: boolean } | undefined {
  if (previous === 0) return undefined;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { value: Math.abs(pct), positive: pct >= 0 };
}

const PERIOD_LABELS: Record<PeriodValue, string> = {
  today: "Hoje",
  week: "Esta semana",
  month: "Este mês",
  "30d": "Últimos 30 dias",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
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

  // Period from URL (?period=month is default)
  const { period: rawPeriod } = await searchParams;
  const period = parsePeriod(rawPeriod);
  const { start: periodStart, prevStart, prevEnd } = getPeriodRanges(period, now);

  // Fixed 6-month window for the chart — always macro, ignores period selector
  const sixMonthsAgo = new Date(now.getTime() - 182 * 24 * 60 * 60 * 1000).toISOString();

  // Alert thresholds
  const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  // ── All queries in parallel ───────────────────────────────────────────────
  const [
    // Cumulative / current-state (no period filter)
    totalLeadsRes,
    openConvsRes,
    waitingRes,
    // Current period
    newLeadsRes,
    wonRevenueRes,
    wonCountRes,
    lostCountRes,
    // Previous period (for trend delta)
    newLeadsPrevRes,
    wonRevenuePrevRes,
    wonCountPrevRes,
    lostCountPrevRes,
    // Charts & funnel
    recentLeadsRes,
    sourceLeadsRes,
    pipelinesRes,
    leadsWithStageRes,
    // Alerts
    alertUnassignedRes,
    alertWaitingRes,
    alertInactiveRes,
    activitiesRes,
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId),
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

    // Current period
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", periodStart),
    supabase
      .from("deals")
      .select("value")
      .eq("organization_id", orgId)
      .eq("status", "won")
      .gte("closed_at", periodStart),
    supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "won")
      .gte("closed_at", periodStart),
    supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "lost")
      .gte("closed_at", periodStart),

    // Previous period
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", prevStart)
      .lte("created_at", prevEnd),
    supabase
      .from("deals")
      .select("value")
      .eq("organization_id", orgId)
      .eq("status", "won")
      .gte("closed_at", prevStart)
      .lte("closed_at", prevEnd),
    supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "won")
      .gte("closed_at", prevStart)
      .lte("closed_at", prevEnd),
    supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "lost")
      .gte("closed_at", prevStart)
      .lte("closed_at", prevEnd),

    // Charts
    supabase
      .from("leads")
      .select("created_at")
      .eq("organization_id", orgId)
      .gte("created_at", sixMonthsAgo),
    supabase
      .from("leads")
      .select("source")
      .eq("organization_id", orgId)
      .gte("created_at", periodStart),
    supabase
      .from("pipelines")
      .select("id, name, pipeline_stages(id, name, color)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true })
      .limit(1),
    supabase
      .from("leads")
      .select("stage_id")
      .eq("organization_id", orgId)
      .not("stage_id", "is", null),

    // Alert: leads sem responsavel
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("assigned_to", null)
      .neq("status", "customer")
      .neq("status", "lost"),
    // Alert: conversas esperando > 2h
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "waiting_human")
      .lt("updated_at", twoHoursAgo),
    // Alert: leads inativos 7d
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .neq("status", "customer")
      .neq("status", "lost")
      .not("assigned_to", "is", null)
      .lt("updated_at", sevenDaysAgo),
    // Feed: last 8 activities
    listOrgActivities({ db: supabase, orgId }, { page: 1, limit: 8 }),
  ]);

  // ── Revenue ───────────────────────────────────────────────────────────────
  const revenueNow = (wonRevenueRes.data ?? []).reduce(
    (acc, d) => acc + (Number((d as { value?: unknown }).value) || 0),
    0,
  );
  const revenuePrev = (wonRevenuePrevRes.data ?? []).reduce(
    (acc, d) => acc + (Number((d as { value?: unknown }).value) || 0),
    0,
  );

  // ── Counts ────────────────────────────────────────────────────────────────
  const newLeadsNow = newLeadsRes.count ?? 0;
  const newLeadsPrev = newLeadsPrevRes.count ?? 0;
  const wonNow = wonCountRes.count ?? 0;
  const wonPrev = wonCountPrevRes.count ?? 0;
  const lostNow = lostCountRes.count ?? 0;
  const lostPrev = lostCountPrevRes.count ?? 0;
  const closedNow = wonNow + lostNow;
  const closedPrev = wonPrev + lostPrev;
  const conversionNow = closedNow > 0 ? Math.round((wonNow / closedNow) * 100) : 0;
  const conversionPrev = closedPrev > 0 ? Math.round((wonPrev / closedPrev) * 100) : 0;

  // ── Alert counts
  const alertUnassigned = alertUnassignedRes.count ?? 0;
  const alertWaiting = alertWaitingRes.count ?? 0;
  const alertInactive = alertInactiveRes.count ?? 0;
  const recentActivities = activitiesRes.activities;

  // ── Trends ────────────────────────────────────────────────────────────────
  const trendLeads = calcTrend(newLeadsNow, newLeadsPrev);
  const trendRevenue = calcTrend(revenueNow, revenuePrev);
  const trendWon = calcTrend(wonNow, wonPrev);
  const trendConversion = calcTrend(conversionNow, conversionPrev);

  // ── 6-month chart ─────────────────────────────────────────────────────────
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

  // ── Sources ───────────────────────────────────────────────────────────────
  const sourceCounts: Record<string, number> = {};
  for (const l of (sourceLeadsRes.data ?? []) as { source: string }[]) {
    const s = l.source || "Desconhecida";
    sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
  }
  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const maxSourceCount = topSources[0]?.[1] ?? 1;

  // ── Funnel ────────────────────────────────────────────────────────────────
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

  // ── Labels ────────────────────────────────────────────────────────────────
  const rawDate = now.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const periodLabel = PERIOD_LABELS[period];

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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageTitle size="compact">Dashboard</PageTitle>
          <p className="text-sm text-muted-foreground mt-1">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector current={period} />
          <Link
            href="/crm"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            <Users className="size-3.5" />
            Leads
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            <MessageSquare className="size-3.5" />
            Chat
          </Link>
          <Link
            href="/agenda"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
          >
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
          description="acumulado"
          icon={Users}
        />
        <KpiCard
          title="Novos no Período"
          value={newLeadsNow.toLocaleString("pt-BR")}
          description={periodLabel}
          icon={TrendingUp}
          trend={trendLeads}
        />
        <KpiCard
          title="Vendas Fechadas"
          value={wonNow.toLocaleString("pt-BR")}
          description={periodLabel}
          icon={Target}
          trend={trendWon}
        />
        <KpiCard
          title="Receita do Período"
          value={
            revenueNow > 0
              ? revenueNow.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                  maximumFractionDigits: 0,
                })
              : "R$ 0"
          }
          description={periodLabel}
          icon={DollarSign}
          trend={trendRevenue}
        />
      </div>

      {/* KPIs — linha 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          title="Taxa de Conversão"
          value={`${conversionNow}%`}
          description={
            closedNow > 0
              ? `${wonNow} ganhos de ${closedNow} fechados`
              : "sem negócios fechados"
          }
          icon={BarChart3}
          trend={trendConversion}
        />
        <KpiCard
          title="Conversas Abertas"
          value={(openConvsRes.count ?? 0).toLocaleString("pt-BR")}
          icon={MessageSquare}
        />
        <div className="col-span-2 lg:col-span-1">
          <KpiCard
            title="Aguardando Humano"
            value={(waitingRes.count ?? 0).toLocaleString("pt-BR")}
            icon={Clock}
            variant={(waitingRes.count ?? 0) > 0 ? "warning" : "default"}
          />
        </div>
      </div>

      {/* Alertas operacionais */}
      <AlertsPanel
        alerts={[
          { id: "unassigned", icon: UserX, count: alertUnassigned, label: "leads sem responsável", href: "/crm", variant: "error" },
          { id: "waiting", icon: Clock, count: alertWaiting, label: "conversas aguardando há mais de 2h", href: "/chat", variant: "warning" },
          { id: "inactive", icon: UserMinus, count: alertInactive, label: "leads sem atividade há 7+ dias", href: "/crm", variant: "muted" },
        ]}
      />

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Leads por mês — sempre 6 meses (macro, não afetado pelo seletor) */}
        <Card className="border rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Leads por Mês</CardTitle>
            <p className="text-xs text-muted-foreground">Últimos 6 meses</p>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            <LeadsByMonthChart data={leadsByMonth} />
          </CardContent>
        </Card>

        {/* Origens — filtra pelo período ativo */}
        <Card className="border rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Origens dos Leads</CardTitle>
            <p className="text-xs text-muted-foreground">{periodLabel}</p>
          </CardHeader>
          <CardContent className="pt-0 pb-4 space-y-3">
            {topSources.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhum lead neste período
              </p>
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

      {/* Funil — estado atual (independente do seletor de período) */}
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
                      style={{
                        width: `${Math.round((stage.count / maxStageCount) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Feed de atividade recente */}
      <ActivityFeed activities={recentActivities} />
    </div>
  );
}
