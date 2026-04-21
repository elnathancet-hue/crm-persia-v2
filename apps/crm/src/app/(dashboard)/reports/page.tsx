import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Users, Bot, Send, BarChart3 } from "lucide-react";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  const orgId = member?.organization_id;
  if (!orgId) return null;

  // Stats
  const { count: totalLeads } = await supabase.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", orgId);
  const { count: totalConversations } = await supabase.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId);
  const { count: totalMessages } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("organization_id", orgId);
  const { count: aiMessages } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("sender", "ai");
  const { count: totalCampaigns } = await supabase.from("campaigns").select("*", { count: "exact", head: true }).eq("organization_id", orgId);

  const aiRate = totalMessages && totalMessages > 0 ? Math.round(((aiMessages || 0) / totalMessages) * 100) : 0;

  const stats = [
    { title: "Total de Leads", value: totalLeads || 0, icon: Users, color: "text-blue-500" },
    { title: "Conversas", value: totalConversations || 0, icon: MessageSquare, color: "text-green-500" },
    { title: "Mensagens Totais", value: totalMessages || 0, icon: Send, color: "text-purple-500" },
    { title: "Mensagens da IA", value: aiMessages || 0, icon: Bot, color: "text-cyan-500" },
    { title: "Taxa da IA", value: `${aiRate}%`, icon: BarChart3, color: "text-amber-500" },
    { title: "Campanhas", value: totalCampaigns || 0, icon: Send, color: "text-pink-500" },
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
      <h1 className="text-2xl font-bold tracking-tight font-heading">Relatórios</h1>

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
                  <p className="text-2xl font-bold tracking-tight font-heading">{stat.value}</p>
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
