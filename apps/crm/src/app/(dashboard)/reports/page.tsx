import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";
import { PageTitle } from "@persia/ui/typography";

export const metadata = { title: "Relatórios" };

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

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

  // ─── Queries paralelas ────────────────────────────────────────────────────
  const [
    { data: pipelines },
    { data: allDeals },
    { data: tags },
    { data: leadsForTags },
    { data: leadsRaw },
  ] = await Promise.all([
    supabase
      .from("pipelines")
      .select("id, name, pipeline_stages(id, name, sort_order)")
      .eq("organization_id", orgId)
      .order("created_at"),
    supabase
      .from("deals")
      .select("id, pipeline_id, stage_id, status, value")
      .eq("organization_id", orgId),
    supabase
      .from("tags")
      .select("id, name, color")
      .eq("organization_id", orgId)
      .order("name"),
    supabase
      .from("leads")
      .select("id, status, lead_tags(tag_id)")
      .eq("organization_id", orgId),
    supabase.from("leads").select("source, status").eq("organization_id", orgId),
  ]);

  // crm_campaigns e crm_campaign_recipients não estão nos tipos gerados ainda
  // (migration 088 aplicada mas `supabase gen types` não rodou). Cast necessário.
  type CampaignRow = { id: string; name: string; status: string; created_at: string };
  type RecipientRow = { campaign_id: string; status: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: campaigns } = (await (supabase as any)
    .from("crm_campaigns")
    .select("id, name, status, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(30)) as { data: CampaignRow[] | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: campaignRecipients } = (await (supabase as any)
    .from("crm_campaign_recipients")
    .select("campaign_id, status")
    .eq("organization_id", orgId)) as { data: RecipientRow[] | null };

  // ─── Agregações ───────────────────────────────────────────────────────────

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
    const st = lead.status ?? "new";
    for (const lt of (lead.lead_tags ?? []) as { tag_id: string }[]) {
      const cur = tagStats.get(lt.tag_id) ?? {};
      cur[st] = (cur[st] || 0) + 1;
      tagStats.set(lt.tag_id, cur);
    }
  }

  // 3. Origem: contagem por source + status
  const sourceStats = new Map<string, Record<string, number>>();
  for (const lead of leadsRaw ?? []) {
    const src = lead.source || "manual";
    const st = lead.status ?? "new";
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

  // 4. Campanhas: destinatários agrupados por status
  const recipientsByCampaign = new Map<string, Record<string, number>>();
  for (const r of campaignRecipients ?? []) {
    const cur = recipientsByCampaign.get(r.campaign_id) ?? {};
    cur[r.status] = (cur[r.status] || 0) + 1;
    recipientsByCampaign.set(r.campaign_id, cur);
  }

  // ─── Labels ───────────────────────────────────────────────────────────────
  const campaignStatusLabels: Record<string, string> = {
    draft: "Rascunho",
    validating: "Validando",
    scheduled: "Agendada",
    running: "Rodando",
    paused: "Pausada",
    completed: "Concluída",
    cancelled: "Cancelada",
    failed: "Falhou",
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
  const isEmpty = !hasPipelines && !hasSources && !hasTags && !hasCampaigns;

  return (
    <div className="space-y-6">
      <PageTitle size="compact">Relatórios</PageTitle>

      {isEmpty && (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground text-sm">
              Nenhum dado para exibir ainda. Crie leads, tags, funis e campanhas
              para ver os relatórios aqui.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── 1. Funil de Vendas ─────────────────────────────────────────────── */}
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
              const wonTotal = pipelineDeals.filter(
                (d) => d.status === "won",
              ).length;
              const convRate =
                pipelineTotal > 0
                  ? Math.round((wonTotal / pipelineTotal) * 100)
                  : 0;

              return (
                <div key={pipeline.id}>
                  <div className="flex items-baseline gap-3 mb-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {pipeline.name}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {pipelineTotal} deal{pipelineTotal !== 1 ? "s" : ""} ·{" "}
                      {convRate}% conversão
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 pr-6 text-xs font-medium text-muted-foreground">
                            Etapa
                          </th>
                          <th className="text-right py-2 px-4 text-xs font-medium text-muted-foreground">
                            Em andamento
                          </th>
                          <th className="text-right py-2 px-4 text-xs font-medium text-muted-foreground">
                            Ganhos
                          </th>
                          <th className="text-right py-2 px-4 text-xs font-medium text-muted-foreground">
                            Perdidos
                          </th>
                          <th className="text-right py-2 pl-4 text-xs font-medium text-muted-foreground">
                            Valor total
                          </th>
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
                            <tr
                              key={stage.id}
                              className="border-b border-border/50 hover:bg-muted/30"
                            >
                              <td className="py-2.5 pr-6 font-medium">
                                {stage.name}
                              </td>
                              <td className="text-right py-2.5 px-4 tabular-nums">
                                {s.open}
                              </td>
                              <td className="text-right py-2.5 px-4 tabular-nums text-success font-medium">
                                {s.won}
                              </td>
                              <td className="text-right py-2.5 px-4 tabular-nums text-destructive">
                                {s.lost}
                              </td>
                              <td className="text-right py-2.5 pl-4 tabular-nums text-muted-foreground">
                                {fmtBRL(s.value)}
                              </td>
                            </tr>
                          );
                        })}
                        {stages.every((stage) => {
                          const s = dealsByStage.get(stage.id);
                          return !s || s.open + s.won + s.lost === 0;
                        }) && (
                          <tr>
                            <td
                              colSpan={5}
                              className="py-4 text-center text-xs text-muted-foreground"
                            >
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

      {/* ── 2. Leads por Origem ────────────────────────────────────────────── */}
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
                    <th className="text-left py-2 pr-6 text-xs font-medium text-muted-foreground">
                      Origem
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Total
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      %
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Novo
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Contatado
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Qualificado
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Cliente
                    </th>
                    <th className="text-right py-2 pl-3 text-xs font-medium text-muted-foreground">
                      Conv.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sourceSorted.map(({ src, stats, total }) => {
                    const pct =
                      totalLeads > 0
                        ? Math.round((total / totalLeads) * 100)
                        : 0;
                    const customers = stats["customer"] ?? 0;
                    const convRate =
                      total > 0 ? Math.round((customers / total) * 100) : 0;
                    return (
                      <tr
                        key={src}
                        className="border-b border-border/50 hover:bg-muted/30"
                      >
                        <td className="py-2.5 pr-6 font-medium capitalize">
                          {src}
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums font-semibold">
                          {total}
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-muted-foreground">
                          {pct}%
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums">
                          {stats["new"] ?? 0}
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums">
                          {stats["contacted"] ?? 0}
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums">
                          {stats["qualified"] ?? 0}
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-success font-semibold">
                          {customers}
                        </td>
                        <td className="text-right py-2.5 pl-3 tabular-nums">
                          <span
                            className={
                              convRate >= 10
                                ? "text-success font-semibold"
                                : "text-muted-foreground"
                            }
                          >
                            {convRate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border">
                    <td className="py-2.5 pr-6 font-semibold text-foreground">
                      Total
                    </td>
                    <td className="text-right py-2.5 px-3 tabular-nums font-bold">
                      {totalLeads}
                    </td>
                    <td colSpan={6} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 3. Leads por Tag ──────────────────────────────────────────────── */}
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
                    <th className="text-left py-2 pr-6 text-xs font-medium text-muted-foreground">
                      Tag
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Total
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Novo
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Contatado
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Qualificado
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Cliente
                    </th>
                    <th className="text-right py-2 pl-3 text-xs font-medium text-muted-foreground">
                      Conv.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(tags ?? [])
                    .map((tag) => ({
                      tag,
                      stats: tagStats.get(tag.id) ?? {},
                      total: Object.values(
                        tagStats.get(tag.id) ?? {},
                      ).reduce((a, b) => a + b, 0),
                    }))
                    .filter((r) => r.total > 0)
                    .sort((a, b) => b.total - a.total)
                    .map(({ tag, stats, total }) => {
                      const customers = stats["customer"] ?? 0;
                      const convRate =
                        total > 0
                          ? Math.round((customers / total) * 100)
                          : 0;
                      return (
                        <tr
                          key={tag.id}
                          className="border-b border-border/50 hover:bg-muted/30"
                        >
                          <td className="py-2.5 pr-6">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="size-2.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor: tag.color ?? "#3b82f6",
                                }}
                              />
                              <span className="font-medium">{tag.name}</span>
                            </span>
                          </td>
                          <td className="text-right py-2.5 px-3 tabular-nums font-semibold">
                            {total}
                          </td>
                          <td className="text-right py-2.5 px-3 tabular-nums">
                            {stats["new"] ?? 0}
                          </td>
                          <td className="text-right py-2.5 px-3 tabular-nums">
                            {stats["contacted"] ?? 0}
                          </td>
                          <td className="text-right py-2.5 px-3 tabular-nums">
                            {stats["qualified"] ?? 0}
                          </td>
                          <td className="text-right py-2.5 px-3 tabular-nums text-success font-semibold">
                            {customers}
                          </td>
                          <td className="text-right py-2.5 pl-3 tabular-nums">
                            <span
                              className={
                                convRate >= 10
                                  ? "text-success font-semibold"
                                  : "text-muted-foreground"
                              }
                            >
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

      {/* ── 4. Desempenho de Campanhas ────────────────────────────────────── */}
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
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">
                      Campanha
                    </th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Destinatários
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Concluídos
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Parados †
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                      Falhos
                    </th>
                    <th className="text-right py-2 pl-3 text-xs font-medium text-muted-foreground">
                      Entrega
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(campaigns ?? []).map((campaign) => {
                    const r = recipientsByCampaign.get(campaign.id) ?? {};
                    const total = Object.values(r).reduce(
                      (a, b) => a + b,
                      0,
                    );
                    const completed = r["completed"] ?? 0;
                    const stopped = r["stopped"] ?? 0;
                    const failed = r["failed"] ?? 0;
                    const deliveryRate =
                      total > 0
                        ? Math.round(((completed + stopped) / total) * 100)
                        : 0;
                    return (
                      <tr
                        key={campaign.id}
                        className="border-b border-border/50 hover:bg-muted/30"
                      >
                        <td className="py-2.5 pr-4 font-medium max-w-[180px]">
                          <span className="block truncate">{campaign.name}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className="text-xs">
                            {campaignStatusLabels[campaign.status] ??
                              campaign.status}
                          </Badge>
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums">
                          {total || "—"}
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-success font-medium">
                          {completed || "—"}
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-warning">
                          {stopped || "—"}
                        </td>
                        <td className="text-right py-2.5 px-3 tabular-nums text-destructive">
                          {failed || "—"}
                        </td>
                        <td className="text-right py-2.5 pl-3 tabular-nums">
                          {total > 0 ? (
                            <span
                              className={
                                deliveryRate >= 80
                                  ? "text-success font-semibold"
                                  : "text-muted-foreground"
                              }
                            >
                              {deliveryRate}%
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
              <p className="mt-3 text-xs text-muted-foreground">
                † Parado = lead respondeu antes de receber todas as mensagens
                (stop_on_reply)
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
