"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getReportStats, getLeadsTimeline, getMessagesTimeline } from "@/actions/reports";
import { BarChart3, Loader2, MessageSquare, Users, Bot, Megaphone, TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";
import { NoContextFallback } from "@/components/no-context-fallback";

const AreaChart = dynamic(() => import("recharts").then(m => m.AreaChart), { ssr: false });
const Area = dynamic(() => import("recharts").then(m => m.Area), { ssr: false });
const BarChart = dynamic(() => import("recharts").then(m => m.BarChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then(m => m.Bar), { ssr: false });
const XAxis = dynamic(() => import("recharts").then(m => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then(m => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then(m => m.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then(m => m.ResponsiveContainer), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then(m => m.CartesianGrid), { ssr: false });
const Legend = dynamic(() => import("recharts").then(m => m.Legend), { ssr: false });

export default function ReportsPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [stats, setStats] = useState<any>(null);
  const [leadsChart, setLeadsChart] = useState<any[]>([]);
  const [msgsChart, setMsgsChart] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isManagingClient) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      getReportStats(),
      getLeadsTimeline(30),
      getMessagesTimeline(30),
    ]).then(([s, leads, msgs]) => {
      setStats(s);
      setLeadsChart(leads);
      setMsgsChart(msgs);
      setLoading(false);
    });
  }, [activeOrgId]);

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>;

  const statCards = [
    { label: "Leads", value: stats?.leads || 0, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Conversas", value: stats?.conversations || 0, icon: MessageSquare, color: "text-purple-400", bg: "bg-purple-500/10" },
    { label: "Conversas Fechadas", value: stats?.closedConversations || 0, icon: MessageSquare, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Mensagens", value: stats?.messages || 0, icon: MessageSquare, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Mensagens IA", value: stats?.aiMessages || 0, icon: Bot, color: "text-cyan-400", bg: "bg-cyan-500/10" },
    { label: "Campanhas", value: stats?.campaigns || 0, icon: Megaphone, color: "text-pink-400", bg: "bg-pink-500/10" },
  ];

  const tooltipStyle = {
    contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 },
    labelStyle: { color: "var(--muted-foreground)" },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Relatórios</h1>
        <p className="text-sm text-muted-foreground">{activeOrgName} — Últimos 30 dias</p>
      </div>

      {/* Value card */}
      <div className="bg-gradient-to-r from-primary/20 to-primary/10 border border-primary/20 rounded-xl p-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="size-8 text-primary" />
          <div>
            <p className="text-sm text-primary/80">Valor Total em Deals</p>
            <p className="text-3xl font-bold text-foreground">
              R$ {(stats?.dealValue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {statCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-card border border-border rounded-xl p-4">
              <div className={`size-10 rounded-xl flex items-center justify-center mb-3 ${c.bg}`}>
                <Icon className={`size-5 ${c.color}`} />
              </div>
              <p className="text-2xl font-bold text-foreground">{c.value.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
            </div>
          );
        })}
      </div>

      {/* Leads Chart */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">Novos Leads por Dia</h2>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={leadsChart}>
              <defs>
                <linearGradient id="leadGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Area type="monotone" dataKey="leads" stroke="#3b82f6" fillOpacity={1} fill="url(#leadGrad)" strokeWidth={2} name="Leads" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Messages Chart */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">Mensagens por Dia (Humano vs IA)</h2>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={msgsChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
              <Bar dataKey="humano" fill="#8b5cf6" radius={[2, 2, 0, 0]} name="Humano" />
              <Bar dataKey="ia" fill="#22c55e" radius={[2, 2, 0, 0]} name="IA" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
