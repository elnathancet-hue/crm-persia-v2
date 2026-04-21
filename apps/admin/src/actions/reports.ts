"use server";

import { requireSuperadminForOrg } from "@/lib/auth";


export async function getReportStats() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const [leads, convs, closed, msgs, aiMsgs, campaigns, deals] = await Promise.all([
    admin.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "closed"),
    admin.from("messages").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("messages").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("sender", "ai"),
    admin.from("campaigns").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("deals").select("value").eq("organization_id", orgId),
  ]);

  const totalDealValue = (deals.data || []).reduce((sum: number, d: { value: number | null }) => sum + (d.value || 0), 0);

  return {
    leads: leads.count || 0,
    totalLeads: leads.count || 0,
    conversations: convs.count || 0,
    totalConversations: convs.count || 0,
    closedConversations: closed.count || 0,
    messages: msgs.count || 0,
    aiMessages: aiMsgs.count || 0,
    campaigns: campaigns.count || 0,
    dealValue: totalDealValue,
    pipelineCount: 0,
    automationCount: 0,
  };
}

export async function getLeadsTimeline(days: number = 30) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data: leads } = await admin
    .from("leads")
    .select("created_at")
    .eq("organization_id", orgId)
    .gte("created_at", since.toISOString())
    .order("created_at")
    .limit(10000);

  // Group by day
  const grouped: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toISOString().split("T")[0];
    grouped[key] = 0;
  }

  (leads || []).forEach((l: { created_at: string | null }) => {
    if (!l.created_at) return;
    const key = l.created_at.split("T")[0];
    if (grouped[key] !== undefined) grouped[key]++;
  });

  return Object.entries(grouped).map(([date, count]) => ({
    date: new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    leads: count,
  }));
}

export async function getMessagesTimeline(days: number = 30) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data: msgs } = await admin
    .from("messages")
    .select("created_at, sender")
    .eq("organization_id", orgId)
    .gte("created_at", since.toISOString())
    .order("created_at")
    .limit(50000);

  const grouped: Record<string, { humano: number; ia: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toISOString().split("T")[0];
    grouped[key] = { humano: 0, ia: 0 };
  }

  (msgs || []).forEach((m: { created_at: string | null; sender: string }) => {
    if (!m.created_at) return;
    const key = m.created_at.split("T")[0];
    if (grouped[key]) {
      if (m.sender === "ai") grouped[key].ia++;
      else grouped[key].humano++;
    }
  });

  return Object.entries(grouped).map(([date, counts]) => ({
    date: new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    humano: counts.humano,
    ia: counts.ia,
  }));
}
