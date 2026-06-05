"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { fromAny } from "@/lib/ai-agent/db";

const REPORT_PAGE_SIZE = 1000;

export async function getReportStats() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    leads,
    newLeads,
    convs,
    openConvs,
    waitingConvs,
    closed,
    msgs,
    aiMsgs,
    campaigns,
    pipelines,
    automations,
    deals,
    wonDeals,
    lostDeals,
    wonDealsThisMonth,
  ] = await Promise.all([
    admin.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", orgId).gte("created_at", thirtyDaysAgo),
    admin.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId).neq("status", "closed"),
    admin.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "waiting_human"),
    admin.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "closed"),
    admin.from("messages").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("messages").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("sender", "ai"),
    fromAny(admin, "crm_campaigns").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("pipelines").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("agent_configs").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("deals").select("value").eq("organization_id", orgId),
    admin.from("deals").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "won"),
    admin.from("deals").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "lost"),
    admin.from("deals").select("value").eq("organization_id", orgId).eq("status", "won").gte("closed_at", monthStart),
  ]);

  const totalDealValue = (deals.data || []).reduce((sum: number, d: { value: number | null }) => sum + (d.value || 0), 0);
  const revenueThisMonth = (wonDealsThisMonth.data || []).reduce(
    (sum: number, d: { value: number | null }) => sum + (d.value || 0),
    0,
  );
  const wonCount = wonDeals.count || 0;
  const lostCount = lostDeals.count || 0;
  const closedDeals = wonCount + lostCount;

  return {
    leads: leads.count || 0,
    totalLeads: leads.count || 0,
    newLeads30d: newLeads.count || 0,
    conversations: convs.count || 0,
    totalConversations: convs.count || 0,
    openConversations: openConvs.count || 0,
    waitingConversations: waitingConvs.count || 0,
    closedConversations: closed.count || 0,
    messages: msgs.count || 0,
    aiMessages: aiMsgs.count || 0,
    campaigns: campaigns.count || 0,
    dealValue: totalDealValue,
    revenueThisMonth,
    wonDeals: wonCount,
    lostDeals: lostCount,
    conversionRate: closedDeals > 0 ? Math.round((wonCount / closedDeals) * 100) : 0,
    pipelineCount: pipelines.count || 0,
    automationCount: automations.count || 0,
  };
}

export async function getLeadsTimeline(days: number = 30) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const leads: { created_at: string | null }[] = [];
  for (let offset = 0; ; offset += REPORT_PAGE_SIZE) {
    const { data, error } = await admin
      .from("leads")
      .select("created_at")
      .eq("organization_id", orgId)
      .gte("created_at", since.toISOString())
      .order("created_at")
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (error) throw new Error(`Erro ao carregar historico de leads: ${error.message}`);
    leads.push(...(data || []));
    if (!data || data.length < REPORT_PAGE_SIZE) break;
  }

  // Group by day
  const grouped: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toISOString().split("T")[0];
    grouped[key] = 0;
  }

  leads.forEach((l) => {
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

  const msgs: { created_at: string | null; sender: string }[] = [];
  for (let offset = 0; ; offset += REPORT_PAGE_SIZE) {
    const { data, error } = await admin
      .from("messages")
      .select("created_at, sender")
      .eq("organization_id", orgId)
      .gte("created_at", since.toISOString())
      .order("created_at")
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (error) throw new Error(`Erro ao carregar historico de mensagens: ${error.message}`);
    msgs.push(...(data || []));
    if (!data || data.length < REPORT_PAGE_SIZE) break;
  }

  const grouped: Record<string, { humano: number; ia: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toISOString().split("T")[0];
    grouped[key] = { humano: 0, ia: 0 };
  }

  msgs.forEach((m) => {
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
