import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";
import { KpiValue, PageTitle } from "@persia/ui/typography";
import { MessageSquare, Users, Bot, Send, BarChart3 } from "lucide-react";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // .single() falha pra users com 2+ memberships (PGRST116). Pega o
  // mais antigo — mesmo padrao usado no dashboard.
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const orgId = member?.organization_id;
  if (!orgId) return null;

  // Stats
  const { count: totalLeads } = await supabase.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", orgId);
  const { count: totalConversations } = await supabase.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId);
  const { count: totalMessages } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("organization_id", orgId);
  const { count: aiMessages } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("sender", "ai");
  const { count: totalCampaigns } = await supabase.from("campaigns").select("*", { count: "exact", head: true }).eq("organization_id", orgId);

  const aiRate = totalMessages && totalMessages > 0 ? Math.round(((aiMessages || 0) / totalMessages) * 100) : 0;

  // PR-COLOR-SWEEP: KPIs mapeados pros tokens do DS.
  const stats = [
    { title: "Total de Leads", value: totalLeads || 0, icon: Users, color: "text-primary" },
    { title: "Conversas", value: totalConversations || 0, icon: MessageSquare, color: "text-success" },
    { title: "Mensagens Totais", value: totalMessages || 0, icon: Send, color: "text-progress" },
    { title: "Mensagens da IA", value: aiMessages || 0, icon: Bot, color: "text-chart-2" },
    { title: "Taxa da IA", value: `${aiRate}%`, icon: BarChart3, color: "text-warning" },
    { title: "Campanhas", value: totalCampaigns || 0, icon: Send, color: "text-chart-5" },
  ];

  // Leads by status
  const { data: leadsByStatus } = await supabase
    .from("leads")
    .select("status")
    .eq("organization_id", orgId);

  const statusCounts: Record<string, number> = {};
  (leadsByStatus || []).forEach((l: any) => {
    statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
  });

  const statusLabels: Record<string, string> = {
    new: "Novo",
    contacted: "Contatado",
    qualified: "Qualificado",
    customer: "Cliente",
    lost: "Perdido",
  };

  return (
    <div className="space-y-6">
      <PageTitle size="compact">Relatórios</PageTitle>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardContent className="p-6 flex items-center gap-4">
                <div className={`h-12 w-12 rounded-lg bg-muted flex items-center justify-center`}>
                  <Icon className={`h-6 w-6 ${stat.color}`} />
                </div>
                <div>
                  <KpiValue size="md">{stat.value}</KpiValue>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Leads por Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 bg-muted rounded-lg px-4 py-2">
                <Badge variant="outline">{statusLabels[status] || status}</Badge>
                <span className="font-bold">{count}</span>
              </div>
            ))}
            {Object.keys(statusCounts).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum lead ainda</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
