import { readAdminContext } from "@/lib/admin-context";
import { withAdmin } from "@/lib/supabase-admin";
import { getAdminStats, getOrganizations } from "@/actions/admin";
import { getReportStats, getRecentActivity } from "@/actions/reports";
import { AlertTriangle, BarChart3, Building2, Clock, DollarSign, Kanban, MessageSquare, Target, TrendingUp, Users, Zap } from "lucide-react";
import Link from "next/link";

type OrganizationSummary = Awaited<ReturnType<typeof getOrganizations>>[number];
type ClientReportStats = Awaited<ReturnType<typeof getReportStats>>;
type RecentActivity = Awaited<ReturnType<typeof getRecentActivity>>;

export default async function DashboardPage() {
  const adminContext = await readAdminContext();

  if (adminContext) {
    const [stats, orgRes, activity] = await Promise.all([
      getReportStats().catch(() => null as ClientReportStats | null),
      withAdmin("admin_page_org_name", async (admin) =>
        admin.from("organizations").select("name").eq("id", adminContext.orgId).single()
      ),
      getRecentActivity().catch(() => ({ recentLeads: [], waitingConvs: [] } as RecentActivity)),
    ]);
    const orgName = (orgRes.data as { name?: string } | null)?.name || "Cliente";
    return <ClientDashboardView stats={stats} orgName={orgName} activity={activity} />;
  }

  const [stats, orgs] = await Promise.all([
    getAdminStats().catch(() => ({ organizations: 0, leads: 0, conversations: 0, assistants: 0 })),
    getOrganizations().catch((): OrganizationSummary[] => []),
  ]);

  return <AdminDashboardView stats={stats} orgs={orgs} />;
}

// ============ ADMIN DASHBOARD ============

function AdminDashboardView({
  stats,
  orgs,
}: {
  stats: { organizations: number; leads: number; conversations: number };
  orgs: OrganizationSummary[];
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Painel Administrativo</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: "Clientes", value: stats.organizations, icon: Building2, color: "text-primary bg-primary/10" },
          { label: "Total de Leads", value: stats.leads, icon: Users, color: "text-progress bg-progress-soft" },
          { label: "Conversas", value: stats.conversations, icon: MessageSquare, color: "text-success bg-success-soft" },
        ].map((stat) => (
          <div key={stat.label} className="border border-border rounded-xl bg-card p-6 hover:border-muted-foreground/30 transition-colors">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                <p className="text-3xl font-bold mt-2">{stat.value}</p>
              </div>
              <div className={`size-10 rounded-xl flex items-center justify-center ${stat.color}`}>
                <stat.icon className="size-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Clientes Recentes</h2>
          <Link href="/clients" className="text-sm text-primary hover:underline">Ver todos</Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {orgs.slice(0, 6).map((org) => (
            <Link key={org.id} href={`/clients/${org.id}`}>
              <div className="border border-border rounded-xl bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer flex items-center gap-3">
                <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-primary">{(org.name || "?")[0].toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{org.name}</p>
                  <p className="text-xs text-muted-foreground">{org.plan} - {org.category || "Sem categoria"}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ CLIENT DASHBOARD ============

function ClientDashboardView({
  stats,
  orgName,
  activity,
}: {
  stats: ClientReportStats | null;
  orgName: string;
  activity: RecentActivity;
}) {
  const kpis = [
    { label: "Leads", value: stats?.totalLeads ?? 0, icon: Users, color: "text-progress bg-progress-soft" },
    { label: "Novos (30 dias)", value: stats?.newLeads30d ?? 0, icon: TrendingUp, color: "text-primary bg-primary/10" },
    { label: "Vendas Fechadas", value: stats?.wonDeals ?? 0, icon: Target, color: "text-success bg-success-soft" },
    {
      label: "Receita do Mes",
      value: (stats?.revenueThisMonth ?? 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }),
      icon: DollarSign,
      color: "text-success bg-success-soft",
    },
    { label: "Taxa de Conversao", value: `${stats?.conversionRate ?? 0}%`, icon: BarChart3, color: "text-primary bg-primary/10" },
    { label: "Conversas Abertas", value: stats?.openConversations ?? 0, icon: MessageSquare, color: "text-success bg-success-soft" },
    { label: "Aguardando Humano", value: stats?.waitingConversations ?? 0, icon: Clock, color: "text-warning bg-warning-soft" },
    // PR-H: terminologia "Funis" (plural pq e count) em vez de "Pipeline"
    { label: "Funis", value: stats?.pipelineCount ?? 0, icon: Kanban, color: "text-progress bg-progress-soft" },
    { label: "Automações", value: stats?.automationCount ?? 0, icon: Zap, color: "text-warning bg-warning-soft" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{orgName}</h1>
        <p className="text-sm text-muted-foreground mt-1">Visao geral da conta</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="border border-border rounded-xl bg-card p-6 hover:border-muted-foreground/30 transition-colors">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                <p className="text-2xl font-bold mt-2">{kpi.value}</p>
              </div>
              <div className={`size-10 rounded-xl flex items-center justify-center ${kpi.color}`}>
                <kpi.icon className="size-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Alertas: conversas aguardando humano */}
      {activity.waitingConvs.length > 0 && (
        <div className="border border-warning/30 bg-warning/5 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="size-4 text-warning shrink-0" />
            <p className="text-sm font-semibold text-warning">
              {activity.waitingConvs.length} conversa{activity.waitingConvs.length !== 1 ? "s" : ""} aguardando atendimento humano
            </p>
          </div>
          <div className="space-y-1.5">
            {activity.waitingConvs.map((conv) => {
              const lead = (conv as { leads?: { name?: string; phone?: string } | null }).leads;
              return (
                <Link
                  key={conv.id}
                  href={`/chat?conversationId=${conv.id}`}
                  className="flex items-center justify-between rounded-lg bg-card border border-border px-3 py-2 hover:border-warning/40 transition-colors"
                >
                  <span className="text-sm font-medium truncate">
                    {lead?.name || lead?.phone || "Lead desconhecido"}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">Ver chat →</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Leads recentes */}
      {activity.recentLeads.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Leads Recentes</h2>
            <Link href="/crm" className="text-xs text-primary hover:underline">Ver todos</Link>
          </div>
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            {activity.recentLeads.map((lead, i) => {
              const l = lead as {
                id: string;
                name: string | null;
                phone: string | null;
                status: string | null;
                source: string | null;
                created_at: string | null;
              };
              const statusColors: Record<string, string> = {
                new: "text-muted-foreground",
                contacted: "text-primary",
                qualified: "text-progress",
                customer: "text-success",
              };
              return (
                <div
                  key={l.id}
                  className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t border-border/50" : ""} hover:bg-muted/30 transition-colors`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{l.name || l.phone || "Sem nome"}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {l.source || "manual"} · {l.created_at ? new Date(l.created_at).toLocaleDateString("pt-BR") : "—"}
                    </p>
                  </div>
                  <span className={`text-xs font-medium capitalize shrink-0 ml-3 ${statusColors[l.status ?? ""] ?? "text-muted-foreground"}`}>
                    {l.status ?? "novo"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/chat" className="border border-border rounded-xl bg-card p-5 hover:border-primary/30 transition-colors">
          <MessageSquare className="size-5 text-primary mb-2" />
          <p className="font-medium text-sm">Chat</p>
          <p className="text-xs text-muted-foreground">Atendimento ao vivo</p>
        </Link>
        <Link href="/crm" className="border border-border rounded-xl bg-card p-5 hover:border-primary/30 transition-colors">
          <Users className="size-5 text-progress mb-2" />
          <p className="font-medium text-sm">Leads</p>
          <p className="text-xs text-muted-foreground">Gerenciar base de leads</p>
        </Link>
        <Link href="/reports" className="border border-border rounded-xl bg-card p-5 hover:border-primary/30 transition-colors">
          <BarChart3 className="size-5 text-success mb-2" />
          <p className="font-medium text-sm">Relatorios</p>
          <p className="text-xs text-muted-foreground">Metricas e graficos</p>
        </Link>
      </div>
    </div>
  );
}
