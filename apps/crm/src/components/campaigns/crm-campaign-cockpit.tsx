"use client";

import React, { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageTitle } from "@persia/ui/typography";
import { Badge } from "@persia/ui/badge";
import { RelativeTime } from "@persia/ui/relative-time";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Button } from "@persia/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@persia/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@persia/ui/table";
import { Input } from "@persia/ui/input";
import { ArrowLeft, Users, Send, Clock, XCircle, SkipForward, RefreshCw, MessageCircle, FileDown, Search, AlertCircle, RotateCcw } from "lucide-react";

import { CrmCampaignActions } from "./crm-campaign-actions";
import { reprocessCampaignFailures } from "@/actions/crm-campaigns";
import type { CrmCampaignWithDetails, CrmCampaignRecipient, CrmCampaignEvent, CampaignStatus, CampaignKind } from "@persia/shared/crm";

const STATUS_UI: Record<CampaignStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft:      { label: "Rascunho",   variant: "secondary" },
  validating: { label: "Validando",  variant: "outline" },
  scheduled:  { label: "Agendada",   variant: "outline" },
  running:    { label: "Enviando",   variant: "default" },
  paused:     { label: "Pausada",    variant: "secondary" },
  completed:  { label: "Concluída",  variant: "default" },
  cancelled:  { label: "Cancelada",  variant: "destructive" },
  failed:     { label: "Falhou",     variant: "destructive" },
};

const KIND_LABEL: Record<CampaignKind, string> = {
  lead_campaign:  "Leads",
  group_campaign: "Grupos",
};

const SEND_MODE_LABEL: Record<string, string> = {
  immediate:             "Imediato",
  scheduled_at:          "Data/hora fixa",
  delay_after_previous:  "Após anterior",
};

interface CockpitProps {
  campaign: CrmCampaignWithDetails;
  recipients: CrmCampaignRecipient[];
  events: CrmCampaignEvent[];
}

export function CrmCampaignCockpit({ campaign, recipients, events }: CockpitProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  const statusUi = STATUS_UI[campaign.status] ?? { label: campaign.status, variant: "secondary" as const };
  const rc = campaign.recipient_counts;
  const jc = campaign.job_counts;

  const displayedRecipients = useMemo(() => {
    if (!search.trim()) return recipients;
    const q = search.toLowerCase();
    return recipients.filter(r =>
      (r.display_name?.toLowerCase() || "").includes(q) ||
      (r.phone?.toLowerCase() || "").includes(q) ||
      (r.chat_jid?.toLowerCase() || "").includes(q) ||
      (r.ineligible_reason?.toLowerCase() || "").includes(q)
    );
  }, [recipients, search]);

  function handleReprocess() {
    if (!confirm("Deseja reprocessar todas as falhas? Elas voltarão para a fila de envio.")) return;
    startTransition(async () => {
      const result = await reprocessCampaignFailures(campaign.id);
      if (result && "error" in result) {
        alert(result.error);
      }
    });
  }

  function handleExport() {
    const headers = ["Nome", "Contato", "Tipo", "Status", "Motivo/Erro", "Data"];
    const rows = recipients.map(r => [
      r.display_name ?? "",
      r.phone ?? r.chat_jid ?? "",
      r.recipient_type,
      r.status,
      r.ineligible_reason ?? "",
      new Date(r.created_at).toLocaleString("pt-BR")
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(e => e.map(f => `"${String(f).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `campanha_${campaign.name.replace(/\s+/g, "_")}_destinatarios.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4 flex-1">
          <Button variant="ghost" size="icon" onClick={() => router.push("/campaigns")} className="mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <PageTitle size="compact">{campaign.name}</PageTitle>
              <Badge variant={statusUi.variant}>{statusUi.label}</Badge>
              <span className="text-sm text-muted-foreground">{KIND_LABEL[campaign.kind]}</span>
            </div>
            {campaign.description && (
              <p className="text-sm text-muted-foreground mt-1">{campaign.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {jc && jc.failed > 0 && (
            <Button variant="outline" size="sm" onClick={handleReprocess} disabled={isPending} className="text-destructive hover:text-destructive">
              <RotateCcw className="h-4 w-4 mr-2" />
              Reprocessar Falhas ({jc.failed})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => router.refresh()} disabled={isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <CrmCampaignActions campaign={campaign} />
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="recipients">
            Destinatários <Badge variant="secondary" className="ml-2 text-[10px] py-0">{rc?.total ?? 0}</Badge>
          </TabsTrigger>
          <TabsTrigger value="events">Eventos</TabsTrigger>
        </TabsList>

        {/* Tab: Overview */}
        <TabsContent value="overview" className="space-y-6">
          {/* Stats */}
          {rc && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              <StatCard icon={<Users className="h-4 w-4 text-muted-foreground" />} label="Total" value={rc.total} />
              <StatCard icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Pendentes" value={rc.pending} />
              <StatCard icon={<Send className="h-4 w-4 text-success" />} label="Enviados" value={jc?.sent ?? 0} />
              <StatCard icon={<Clock className="h-4 w-4 text-progress" />} label="Na fila" value={jc?.queued ?? 0} />
              <StatCard icon={<XCircle className="h-4 w-4 text-destructive" />} label="Falhas" value={jc?.failed ?? 0} />
              <StatCard icon={<SkipForward className="h-4 w-4 text-warning" />} label="Pulados" value={jc?.skipped ?? 0} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-medium">Fluxo de Mensagens ({campaign.steps.length})</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {campaign.steps.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma mensagem</p>
                ) : (
                  campaign.steps.map((step, i) => (
                    <div key={step.id} className="border rounded-md p-4 space-y-2 bg-muted/20">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="flex items-center justify-center bg-primary text-primary-foreground font-bold text-xs size-5 rounded-full">{i + 1}</span>
                        <span className="text-sm font-semibold">{SEND_MODE_LABEL[step.send_mode] ?? step.send_mode}</span>
                        {step.media_type !== "none" && (
                          <Badge variant="outline" className="text-[10px] ml-auto uppercase">{step.media_type}</Badge>
                        )}
                      </div>

                      {step.message_text && (
                        <div className="text-sm p-3 bg-card border rounded-md whitespace-pre-wrap">
                          {step.message_text}
                        </div>
                      )}

                      {step.media_url && (
                        <div className="text-sm p-2 bg-card border rounded-md flex items-center gap-2">
                          <FileDown className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground truncate flex-1">{step.media_filename ?? "Arquivo anexado"}</span>
                          <a href={step.media_url} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs">Visualizar</a>
                        </div>
                      )}

                      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                        {step.scheduled_at && (
                          <span>Agendado: <RelativeTime iso={step.scheduled_at} /></span>
                        )}
                        {step.delay_amount && step.delay_unit && (
                          <span>Espera: {step.delay_amount} {step.delay_unit}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-sm font-medium">Configurações</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-2 text-sm">
                  <Row label="Fuso horário" value={campaign.timezone} />
                  {campaign.send_window_start && campaign.send_window_end && (
                    <Row
                      label="Janela de envio"
                      value={`${campaign.send_window_start} – ${campaign.send_window_end}`}
                    />
                  )}
                  {campaign.rate_limit_per_minute && (
                    <Row label="Limite/min" value={String(campaign.rate_limit_per_minute)} />
                  )}
                  <Row label="Parar na resposta" value={campaign.stop_on_reply ? "Sim" : "Não"} />
                  <Row label="Criada em" value={<RelativeTime iso={campaign.created_at} />} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-sm font-medium">Público Alvo</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  {campaign.targets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum público definido</p>
                  ) : (
                    campaign.targets.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-sm bg-muted/50 p-2 rounded border">
                        <Badge variant="outline" className="text-[10px] bg-background">{t.target_kind}</Badge>
                        {t.target_id ? <span className="text-muted-foreground truncate font-mono text-xs">{t.target_id}</span> : <span className="text-muted-foreground text-xs">Todos</span>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Tab: Recipients */}
        <TabsContent value="recipients">
          <Card>
            <div className="flex items-center justify-between p-4 border-b">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar destinatário..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 pl-9"
                />
              </div>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <FileDown className="h-4 w-4 mr-2" /> Exportar CSV
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedRecipients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Nenhum destinatário encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedRecipients.slice(0, 100).map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.display_name || "--"}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{r.phone || r.chat_jid}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "active" ? "default" : r.status === "ineligible" ? "destructive" : "secondary"}>
                          {r.status === "active" ? "OK" : r.status === "ineligible" ? "Erro" : r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.ineligible_reason ? (
                          <span className="flex items-center gap-1 text-destructive"><AlertCircle className="size-3" /> {r.ineligible_reason}</span>
                        ) : "--"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.phone && (
                          <a href={`https://wa.me/${r.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
                            <Button variant="ghost" size="sm" className="h-8">
                              <MessageCircle className="h-4 w-4 mr-2" /> Chat
                            </Button>
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {displayedRecipients.length > 100 && (
              <div className="p-4 text-center border-t text-sm text-muted-foreground">
                Mostrando 100 de {displayedRecipients.length} resultados. Use a busca ou exporte para ver todos.
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Tab: Events */}
        <TabsContent value="events">
          <Card>
            <CardHeader>
              <CardTitle>Linha do Tempo</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Nenhum evento registrado.</p>
              ) : (
                <div className="space-y-6 pl-4 border-l-2 ml-2">
                  {events.map((evt) => (
                    <div key={evt.id} className="relative">
                      <div className="absolute -left-[25px] top-1 h-3 w-3 rounded-full bg-primary ring-4 ring-background" />
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{evt.event_type.replace(/_/g, " ").toUpperCase()}</span>
                          <span className="text-xs text-muted-foreground"><RelativeTime iso={evt.created_at} /></span>
                        </div>
                        {evt.payload && Object.keys(evt.payload as object).length > 0 && (
                          <div className="text-xs bg-muted/30 p-2 rounded border font-mono mt-1 text-muted-foreground overflow-x-auto">
                            {JSON.stringify(evt.payload, null, 2)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-xs uppercase tracking-wider font-semibold">{label}</span></div>
        <span className="text-2xl font-bold">{value}</span>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
