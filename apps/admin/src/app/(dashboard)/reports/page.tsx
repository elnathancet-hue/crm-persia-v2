import { notFound } from "next/navigation";
import { requireSuperadminForOrg } from "@/lib/auth";
import { readAdminContext } from "@/lib/admin-context";
import { NoContextFallback } from "@/components/no-context-fallback";
import { ReportsFilterBar } from "@/components/reports/reports-filter-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";
import { BarChart3 } from "lucide-react";

export const metadata = { title: "Relatórios" };

type SearchParams = Promise<{ from?: string; to?: string }>;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctxCookie = await readAdminContext();
  if (!ctxCookie) return <NoContextFallback />;

  let ctx: Awaited<ReturnType<typeof requireSuperadminForOrg>>;
  try {
    ctx = await requireSuperadminForOrg();
  } catch {
    notFound();
  }
  const { admin, orgId } = ctx;

  const { from, to } = await searchParams;

  // Validate date format to prevent query injection
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const validFrom = from && iso.test(from) ? from : undefined;
  const validTo = to && iso.test(to) ? `${to}T23:59:59` : undefined;

  // ─── Queries paralelas ──────────────────────────────────────────────────────
  const leadsQuery = admin
    .from("leads")
    .select("id, status, lead_tags(tag_id)")
    .eq("organization_id", orgId);
  if (validFrom) leadsQuery.gte("created_at", validFrom);
  if (validTo) leadsQuery.lte("created_at", validTo);

  const leadsRawQuery = admin
    .from("leads")
    .select("source, status")
    .eq("organization_id", orgId);
  if (validFrom) leadsRawQuery.gte("created_at", validFrom);
  if (validTo) leadsRawQuery.lte("created_at", validTo);

  const dealsQuery = admin
    .from("deals")
    .select("id, pipeline_id, stage_id, status, value")
    .eq("organization_id", orgId);
  if (validFrom) dealsQuery.gte("created_at", validFrom);
  if (validTo) dealsQuery.lte("created_at", validTo);

  const apptsQuery = admin
    .from("appointments")
    .select("id, status, channel")
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (validFrom) apptsQuery.gte("start_at", validFrom);
  if (validTo) apptsQuery.lte("start_at", validTo);

  const campaignsQuery = admin
    .from("campaigns")
    .select(
      "id, name, status, total_target, total_sent, total_delivered, total_read, total_replied, created_at",
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (validFrom) campaignsQuery.gte("created_at", validFrom);
  if (validTo) campaignsQuery.lte("created_at", validTo);

  const [
    { data: pipelines },
    { data: allDeals },
    { data: tags },
    { data: leadsForTags },
    { data: leadsRaw },
    { data: campaigns },
    { data: appointments },
  ] = await Promise.all([
    admin
      .from("pipelines")
      .select("id, name, pipeline_stages(id, name, sort_order)")
      .eq("organization_id", orgId)
      .order("created_at"),
    dealsQuery,
    admin
      .from("tags")
      .select("id, name, color")
      .eq("organization_id", orgId)
      .order("name"),
    leadsQuery,
    leadsRawQuery,
    campaignsQuery,
    apptsQuery,
  ]);

  // ─── Agregações ─────────────────────────────────────────────────────────────

  // 1. Funil: deals agrupados por stage
  const dealsByStage = new Map<
    string,
    { open: number; won: number; lost: number; value: number }
  >();
  for (const deal of allDeals ?? []) {
    const cur = dealsByStage.get(deal.stage_id) ?? {
      open: 0,
      won: 0,
      lost: 0,
      value: 0,
    };
    if (deal.status === "won") cur.won++;
    else if (deal.status === "lost") cur.lost++;
    else cur.open++;
    cur.value += Number(deal.value ?? 0);
    dealsByStage.set(deal.stage_id, cur);
  }

  // 2. Tags: contagem de leads por tag + status
  const tagStats = new Map<string, Record<string, number>>();
  for (const lead of leadsForTags ?? []) {
    const st = (lead as { status: string | null }).status ?? "new";
    for (const lt of ((lead as { lead_tags: { tag_id: string }[] }).lead_tags) ?? []) {
      const cur = tagStats.get(lt.tag_id) ?? {};
      cur[st] = (cur[st] || 0) + 1;
      tagStats.set(lt.tag_id, cur);
    }
  }

  // 3. Origem: contagem por source + status
  const sourceStats = new Map<string, Record<string, number>>();
  for (const lead of leadsRaw ?? []) {
    const src = (lead as { source: string | null }).source || "manual";
    const st = (lead as { status: string | null }).status ?? "new";
    const cur = sourceStats.get(src) ?? {};
    cur[st] = (cur[st] || 0) + 1;
    sourceStats.set(src, cur);
  }
  const sourceSorted = Array.from(sourceStats.entries())
    .map(([src, stats]) => ({
      src,
      stats,
      total: Object.values(stats).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total);
  const totalLeads = sourceSorted.reduce((s, r) => s + r.total, 0);

  // 4. Agenda
  const apptByStatus: Record<string, number> = {};
  const apptByChannel: Record<string, number> = {};
  for (const a of appointments ?? []) {
    const appt = a as { status: string; channel: string | null };
    apptByStatus[appt.status] = (apptByStatus[appt.status] || 0) + 1;
    const ch = appt.channel ?? "não informado";
    apptByChannel[ch] = (apptByChannel[ch] || 0) + 1;
  }
  const totalAppts = (appointments ?? []).length;

  // ─── Labels ─────────────────────────────────────────────────────────────────
  const campaignStatusLabels: Record<string, string> = {
    draft: "Rascunho",
    scheduled: "Agendada",
    sending: "Enviando",
    paused: "Pausada",
    completed: "Concluída",
    cancelled: "Cancelada",
  };

  const apptStatusLabels: Record<string, string> = {
    awaiting_confirmation: "Aguardando confirmação",
    confirmed: "Confirmado",
    completed: "Concluído",
    cancelled: "Cancelado",
    no_show: "Não compareceu",
    rescheduled: "Reagendado",
  };

  const apptStatusColors: Record<string, string> = {
    confirmed: "text-success",
    completed: "text-success",
    cancelled: "text-destructive",
    no_show: "text-warning",
    rescheduled: "text-muted-foreground",
    awaiting_confirmation: "text-muted-foreground",
  };

  const channelLabels: Record<string, string> = {
    whatsapp: "WhatsApp",
    phone: "Telefone",
    online: "Online",
    in_person: "Presencial",
    "não informado": "Não informado",
  };

  const fmtBRL = (v: number) =>
    v.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });

  const hasPipelines = (pipelines ?? []).length > 0;
  const hasSources = sourceSorted.length > 0;
  const hasTags = (tags ?? []).some((t) => tagStats.has(t.id));
  const hasCampaigns = (campaigns ?? []).length > 0;
  const hasAppts = totalAppts > 0;
  const isEmpty = !hasPipelines && !hasSources && !hasTags && !hasCampaigns && !hasAppts;

  const periodLabel =
    validFrom || validTo
      ? `${validFrom ?? "início"} → ${validTo ? validTo.slice(0, 10) : "hoje"}`
      : "Todos os períodos";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight tracking-tight">Relatórios</h1>
            <p className="text-sm text-muted-foreground">{periodLabel}</p>
          </div>
        </div>
        <ReportsFilterBar from={validFrom} to={validTo ? validTo.slice(0, 10) : undefined} />
      </div>
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">Relatórios — {periodLabel}</h1>
      </div>

      {isEmpty && (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground text-sm">
              Nenhum dado para exibir ainda. O cliente precisa criar leads, tags,
              funis, campanhas e agendamentos para ver os relatórios aqui.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── 1. Funil de Vendas ───────────────────────────────────────────────── */}
      {hasPipelines && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Funil de Vendas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {(pipelines ?? []).map((pipeline) => {
              const stages = [
                ...((pipeline.pipeline_stages as {
                  id: string;
                  name: string;
                  sort_order: number;
                }[]) ?? []),
              ].sort((a, b) => a.sort_order - b.sort_order);

              const pipelineDeals = (allDeals ?? []).filter(
                (d) => d.pipeline_id === pipeline.id,
              );
              const pipelineTotal = pipelineDeals.length;
              const wonTotal = pipelineDeals.filter((d) => d.status === "won").length;
              const convRate =
                pipelineTotal > 0 ? Math.round((wonTotal / pipelineTotal) * 100) : 0;

              return (
                <div key={pipeline.id}>
                  <div className="flex items-baseline gap-3 mb-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {pipeline.name}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {pipelineTotal} deal{pipelineTotal !== 1 ? "s" : ""} · {convRate}% conversão
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 pr-6 text-xs font-medium text-muted-foreground">Etapa</th>
                          <th className="text-right py-2 px-4 text-xs font-medium text-muted-foreground">Em andamento</th>
                          <th className="text-right py-2 px-4 text-xs font-medium text-muted-foreground">Ganhos</th>
                          <th className="text-right py-2 px-4 text-xs font-medium text-muted-foreground">Perdidos</th>
                          <th className="text-right py-2 pl-4 text-xs font-medium text-muted-foreground">Valor total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stages.map((stage) => {
                          const s = dealsByStage.get(stage.id) ?? {
                            open: 0,
                            won: 0,
                            lost: 0,
                            value: 0,
                          };
                          const total = s.open + s.won + s.lost;
                          if (total === 0) return null;
                          return (
                            <tr key={stage.id} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="py-2.5 pr-6 font-medium">{stage.name}</td>
                              <td className="text-right py-2.5 px-4 tabular-nums">{s.open}</td>
                              <td className="text-right py-2.5 px-4 tabular-nums text-success font-medium">{s.won}</td>
                              <td className="text-right py-2.5 px-4 tabular-nums text-destructive">{s.lost}</td>
                              <td className="text-right py-2.5 pl-4 tabular-nums text-muted-foreground">{fmtBRL(s.value)}</td>
                            </tr>
                          );
                        })}
                        {stages.every((stage) => {
                          const s = dealsByStage.get(stage.id);
                          return !s || s.open + s.won + s.lost === 0;
                        }) && (
                          <tr>
                            <td colSpan={5} className="py-4 text-center text-xs text-muted-foreground">
                              Nenhum deal neste funil ainda
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── 2. Leads por Origem ──────────────────────────────────────────────── */}
      {hasSources && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Leads por Origem</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-6 text-xs font-medium text-muted-foreground">Origem</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Total</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">%</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Novo</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Contatado</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Qualificado</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Cliente</th>
                    <th className="text-right py-2 pl-3 text-xs font-medium text-muted-foreground">Conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceSorted.map(({ src, stats, total }) => {
                    const pct = totalLeads > 0 ? Math.round((total / totalLeads) * 100) : 0;
                    const customers = stats["customer"] ?? 0;
                    const convRate = total > 0 ? Math.round((customers / total) * 100) : 0;
                    return (
                      <tr key={src} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2.5 pr-6 font-medium capitalize">{src}</td>
                        <td className="text-right py-2.5 px-3 tabular-nums font-semibold">{total}</td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-muted-foreground">{pct}%</td>
                        <td className="text-right py-2.5 px-3 tabular-nums">{stats["new"] ?? 0}</td>
                        <td className="text-right py-2.5 px-3 tabular-nums">{stats["contacted"] ?? 0}</td>
                        <td className="text-right py-2.5 px-3 tabular-nums">{stats["qualified"] ?? 0}</td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-success font-semibold">{customers}</td>
                        <td className="text-right py-2.5 pl-3 tabular-nums">
                          <span className={convRate >= 10 ? "text-success font-semibold" : "text-muted-foreground"}>
                            {convRate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border">
                    <td className="py-2.5 pr-6 font-semibold text-foreground">Total</td>
                    <td className="text-right py-2.5 px-3 tabular-nums font-bold">{totalLeads}</td>
                    <td colSpan={6} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 3. Leads por Tag ─────────────────────────────────────────────────── */}
      {hasTags && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Leads por Tag</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-6 text-xs font-medium text-muted-foreground">Tag</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Total</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Novo</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Contatado</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Qualificado</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Cliente</th>
                    <th className="text-right py-2 pl-3 text-xs font-medium text-muted-foreground">Conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {(tags ?? [])
                    .map((tag) => ({
                      tag,
                      stats: tagStats.get(tag.id) ?? {},
                      total: Object.values(tagStats.get(tag.id) ?? {}).reduce((a, b) => a + b, 0),
                    }))
                    .filter((r) => r.total > 0)
                    .sort((a, b) => b.total - a.total)
                    .map(({ tag, stats, total }) => {
                      const customers = stats["customer"] ?? 0;
                      const convRate = total > 0 ? Math.round((customers / total) * 100) : 0;
                      return (
                        <tr key={tag.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2.5 pr-6">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="size-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: (tag as { color: string | null }).color ?? "#3b82f6" }}
                              />
                              <span className="font-medium">{tag.name}</span>
                            </span>
                          </td>
                          <td className="text-right py-2.5 px-3 tabular-nums font-semibold">{total}</td>
                          <td className="text-right py-2.5 px-3 tabular-nums">{stats["new"] ?? 0}</td>
                          <td className="text-right py-2.5 px-3 tabular-nums">{stats["contacted"] ?? 0}</td>
                          <td className="text-right py-2.5 px-3 tabular-nums">{stats["qualified"] ?? 0}</td>
                          <td className="text-right py-2.5 px-3 tabular-nums text-success font-semibold">{customers}</td>
                          <td className="text-right py-2.5 pl-3 tabular-nums">
                            <span className={convRate >= 10 ? "text-success font-semibold" : "text-muted-foreground"}>
                              {convRate}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 4. Agenda ────────────────────────────────────────────────────────── */}
      {hasAppts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Agenda</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-3">Por status</p>
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(apptByStatus)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => {
                        const pct = totalAppts > 0 ? Math.round((count / totalAppts) * 100) : 0;
                        return (
                          <tr key={status} className="border-b border-border/50">
                            <td className="py-2 pr-4">
                              <span className={`font-medium ${apptStatusColors[status] ?? "text-foreground"}`}>
                                {apptStatusLabels[status] ?? status}
                              </span>
                            </td>
                            <td className="text-right py-2 px-3 tabular-nums font-semibold">{count}</td>
                            <td className="text-right py-2 pl-3 tabular-nums text-muted-foreground">{pct}%</td>
                          </tr>
                        );
                      })}
                    <tr className="border-t border-border">
                      <td className="py-2 pr-4 font-semibold">Total</td>
                      <td className="text-right py-2 px-3 tabular-nums font-bold">{totalAppts}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>

              {Object.keys(apptByChannel).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3">Por canal</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(apptByChannel)
                        .sort((a, b) => b[1] - a[1])
                        .map(([channel, count]) => {
                          const pct = totalAppts > 0 ? Math.round((count / totalAppts) * 100) : 0;
                          return (
                            <tr key={channel} className="border-b border-border/50">
                              <td className="py-2 pr-4 font-medium">
                                {channelLabels[channel] ?? channel}
                              </td>
                              <td className="text-right py-2 px-3 tabular-nums font-semibold">{count}</td>
                              <td className="text-right py-2 pl-3 tabular-nums text-muted-foreground">{pct}%</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 5. Desempenho de Campanhas ───────────────────────────────────────── */}
      {hasCampaigns && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Desempenho de Campanhas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Campanha</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Alvo</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Enviado</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Entregue</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Lido</th>
                    <th className="text-right py-2 pl-3 text-xs font-medium text-muted-foreground">Taxa env.</th>
                  </tr>
                </thead>
                <tbody>
                  {(campaigns ?? []).map((campaign) => {
                    const c = campaign as {
                      id: string;
                      name: string;
                      status: string | null;
                      total_target: number | null;
                      total_sent: number | null;
                      total_delivered: number | null;
                      total_read: number | null;
                    };
                    const target = c.total_target ?? 0;
                    const sent = c.total_sent ?? 0;
                    const delivered = c.total_delivered ?? 0;
                    const read = c.total_read ?? 0;
                    const sendRate = target > 0 ? Math.round((sent / target) * 100) : 0;
                    return (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2.5 pr-4 font-medium max-w-[180px]">
                          <span className="block truncate">{c.name}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className="text-xs">
                            {campaignStatusLabels[c.status ?? ""] ?? c.status}
                          </Badge>
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums">{target || "—"}</td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-primary font-medium">{sent || "—"}</td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-success">{delivered || "—"}</td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-muted-foreground">{read || "—"}</td>
                        <td className="text-right py-2.5 pl-3 tabular-nums">
                          {target > 0 ? (
                            <span className={sendRate >= 80 ? "text-success font-semibold" : "text-muted-foreground"}>
                              {sendRate}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
