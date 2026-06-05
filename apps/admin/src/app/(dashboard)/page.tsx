import { readAdminContext } from "@/lib/admin-context";
import { withAdmin } from "@/lib/supabase-admin";
import { getAdminStats, getOrganizations } from "@/actions/admin";
import { getReportStats } from "@/actions/reports";
import { BarChart3, Building2, Clock, DollarSign, Kanban, MessageSquare, Target, TrendingUp, Users, Zap } from "lucide-react";
import Link from "next/link";

type OrganizationSummary = Awaited<ReturnType<typeof getOrganizations>>[number];
type ClientReportStats = Awaited<ReturnType<typeof getReportStats>>;

export default async function DashboardPage() {
  const adminContext = await readAdminContext();

  if (adminContext) {
    const [stats, orgRes] = await Promise.all([
      getReportStats().catch(() => null as ClientReportStats | null),
      withAdmin("admin_page_org_name", async (admin) =>
        admin.from("organizations").select("name").eq("id", adminContext.orgId).single()
      ),
    ]);
    const orgName = (orgRes.data as { name?: string } | null)?.name || "Cliente";
    return <ClientDashboardView stats={stats} orgName={orgName} />;
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

function ClientDashboardView({ stats, orgName }: { stats: ClientReportStats | null; orgName: string }) {
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
