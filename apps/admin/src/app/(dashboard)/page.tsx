"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getAdminStats, getOrganizations } from "@/actions/admin";
import { getReportStats } from "@/actions/reports";
import { Building2, Users, MessageSquare, Kanban, Zap, BarChart3 } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();

  // In client mode, show CRM dashboard for the selected account
  if (isManagingClient && activeOrgId) {
    return <ClientDashboard orgId={activeOrgId} orgName={activeOrgName} />;
  }

  // In admin mode, show admin overview
  return <AdminDashboard />;
}

// ============ ADMIN DASHBOARD ============

function AdminDashboard() {
  const [stats, setStats] = useState({ organizations: 0, leads: 0, conversations: 0 });
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAdminStats(), getOrganizations()])
      .then(([s, o]) => { setStats(s); setOrgs(o); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

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
          {orgs.slice(0, 6).map((org: any) => (
            <Link key={org.id} href={`/clients/${org.id}`}>
              <div className="border border-border rounded-xl bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer flex items-center gap-3">
                <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-primary">{(org.name || "?")[0].toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{org.name}</p>
                  <p className="text-xs text-muted-foreground">{org.plan} - {org.niche || "Sem nicho"}</p>
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

function ClientDashboard({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getReportStats()
      .then((s) => { setStats(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, [orgId]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const kpis = [
    { label: "Leads", value: stats?.totalLeads ?? 0, icon: Users, color: "text-progress bg-progress-soft" },
    { label: "Conversas", value: stats?.totalConversations ?? 0, icon: MessageSquare, color: "text-success bg-success-soft" },
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="border border-border rounded-xl bg-card p-6 hover:border-muted-foreground/30 transition-colors">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                <p className="text-3xl font-bold mt-2">{kpi.value}</p>
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
        <Link href="/leads" className="border border-border rounded-xl bg-card p-5 hover:border-primary/30 transition-colors">
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
