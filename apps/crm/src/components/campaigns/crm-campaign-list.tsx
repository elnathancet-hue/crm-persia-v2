"use client";

import { useState, useTransition, useMemo, useEffect, useCallback } from "react";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { Card, CardContent } from "@persia/ui/card";
import { Checkbox } from "@persia/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@persia/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { Input } from "@persia/ui/input";
import {
  Plus, Megaphone, MoreHorizontal, Pause, Play, X, Eye, Search, Trash2,
  CalendarDays, Send, AlertCircle, Activity, RefreshCw, Pencil,
} from "lucide-react";
import type { CrmCampaign, CrmCampaignWithDetails } from "@persia/shared/crm";
import {
  pauseCampaign, resumeCampaign, cancelCampaign, deleteCrmCampaign,
  bulkDeleteCrmCampaigns, getCrmCampaignDetails,
} from "@/actions/crm-campaigns";
import type { WhatsAppConnectionStatus } from "@/actions/crm-campaigns";
import { CrmCampaignWizard } from "./crm-campaign-wizard";

const STATUS_UI: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft:      { label: "Rascunho",   variant: "secondary" },
  validating: { label: "Validando",  variant: "outline" },
  scheduled:  { label: "Agendada",   variant: "outline" },
  running:    { label: "Enviando",   variant: "default" },
  paused:     { label: "Pausada",    variant: "secondary" },
  completed:  { label: "Concluída",  variant: "default" },
  cancelled:  { label: "Cancelada",  variant: "destructive" },
  failed:     { label: "Falhou",     variant: "destructive" },
};

const KIND_LABEL: Record<string, string> = {
  lead_campaign:  "Leads",
  group_campaign: "Grupos",
};

interface Props {
  campaigns: CrmCampaign[];
  segments: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  pipelines: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; pipeline_id: string; name: string }>;
  groups: Array<{ id: string; name: string; category: string | null; participant_count: number | null }>;
  whatsappStatus: WhatsAppConnectionStatus;
  initialEditData?: CrmCampaignWithDetails | null;
}

export function CrmCampaignList({ campaigns, segments, tags, pipelines, stages, groups, whatsappStatus, initialEditData }: Props) {
  const [wizardOpen, setWizardOpen] = useState(!!initialEditData);
  const [editData, setEditData] = useState<CrmCampaignWithDetails | null>(initialEditData ?? null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (initialEditData) {
      setEditData(initialEditData);
      setWizardOpen(true);
    }
  }, [initialEditData]);

  const displayed = useMemo(() => {
    if (!search.trim()) return campaigns;
    const q = search.toLowerCase();
    return campaigns.filter((c) => c.name.toLowerCase().includes(q));
  }, [campaigns, search]);

  const handleEdit = useCallback((id: string) => {
    startTransition(async () => {
      const data = await getCrmCampaignDetails(id);
      if (data) {
        setEditData(data);
        setWizardOpen(true);
      }
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === displayed.length
        ? new Set()
        : new Set(displayed.map((c) => c.id)),
    );
  }, [displayed]);

  const activeCount = campaigns.filter((c) => c.status === "scheduled" || c.status === "running").length;
  const scheduledCount = campaigns.filter((c) => c.status === "scheduled").length;
  const completedCount = campaigns.filter((c) => c.status === "completed").length;
  const failedCount = campaigns.filter((c) => c.status === "failed").length;

  const summaryCards = [
    { label: "Campanhas ativas", value: activeCount, icon: Megaphone, tone: "text-primary", bg: "bg-primary/10" },
    { label: "Agendadas", value: scheduledCount, icon: CalendarDays, tone: "text-progress", bg: "bg-progress/10" },
    { label: "Concluidas", value: completedCount, icon: Send, tone: "text-success", bg: "bg-success/10" },
    { label: "Falhas", value: failedCount, icon: AlertCircle, tone: "text-destructive", bg: "bg-destructive/10" },
  ];

  function handlePause(id: string) {
    startTransition(async () => { await pauseCampaign(id); });
  }

  function handleResume(id: string) {
    startTransition(async () => { await resumeCampaign(id); });
  }

  function handleCancel(id: string) {
    if (!confirm("Cancelar esta campanha? Jobs pendentes serão cancelados.")) return;
    startTransition(async () => { await cancelCampaign(id); });
  }

  function handleDelete(campaign: CrmCampaign) {
    if (campaign.status === "scheduled" || campaign.status === "running") {
      alert("Cancele ou pause a campanha antes de excluir.");
      return;
    }
    if (!confirm(`Excluir a campanha "${campaign.name}"? Esta ação remove histórico, destinatários e jobs.`)) return;
    startTransition(async () => { await deleteCrmCampaign(campaign.id); });
  }

  function handleBulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Excluir ${ids.length} campanha(s) selecionada(s)? Campanhas ativas (enviando/agendadas) serão ignoradas.`)) return;
    startTransition(async () => {
      const result = await bulkDeleteCrmCampaigns(ids);
      if (result?.data) {
        const { deleted, skipped } = result.data;
        if (skipped > 0) alert(`${deleted} excluída(s). ${skipped} ignorada(s) por estarem ativas — cancele-as primeiro.`);
      }
      setSelected(new Set());
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar campanhas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
          <Button variant="ghost" size="sm" className="gap-2">
            <Search className="h-4 w-4" />
            Filtros
          </Button>
        </div>
        <Button size="sm" onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Nova campanha
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campanhas WhatsApp</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gerencie envios, avisos para grupos, follow-ups automáticos e campanhas segmentadas com segurança.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardContent className="p-5">
                <div className={`mb-4 flex size-9 items-center justify-center rounded-lg ${card.bg}`}>
                  <Icon className={`size-4 ${card.tone}`} />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {card.label}
                </p>
                <p className="mt-2 text-2xl font-semibold">{card.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {displayed.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14">
            <Megaphone className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-base font-medium">
              {search ? "Nenhuma campanha encontrada" : "Nenhuma campanha ainda"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {search
                ? "Tente outro termo de busca"
                : "Crie campanhas para enviar mensagens em massa para leads ou grupos"}
            </p>
            {!search && (
              <Button className="mt-4" size="sm" onClick={() => setWizardOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Criar Campanha
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-2">
            {selected.size > 0 && (
              <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-4 py-2">
                <span className="text-sm font-medium">{selected.size} selecionada(s)</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    Limpar seleção
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={isPending}>
                    <Trash2 className="h-4 w-4 mr-1.5" /> Excluir selecionadas
                  </Button>
                </div>
              </div>
            )}
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={displayed.length > 0 && selected.size === displayed.length}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Selecionar todas"
                      />
                    </TableHead>
                    <TableHead>Campanha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Envio</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progresso</TableHead>
                    <TableHead className="w-10">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayed.map((c) => {
                    const progress =
                      c.status === "completed" ? 100
                      : c.total_count > 0 ? Math.round((c.sent_count / c.total_count) * 100)
                      : 0;
                    return (
                      <TableRow key={c.id} data-selected={selected.has(c.id)}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(c.id)}
                            onCheckedChange={() => toggleSelect(c.id)}
                            aria-label={`Selecionar ${c.name}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {KIND_LABEL[c.kind] ?? c.kind}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {c.status === "scheduled" ? "Agendada" : new Date(c.created_at).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_UI[c.status]?.variant ?? "secondary"}>
                            {STATUS_UI[c.status]?.label ?? c.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="w-40">
                            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                              <span className="text-success" title="Enviadas">{c.sent_count} env.</span>
                              {c.failed_count > 0 && <span className="text-destructive" title="Falhas">{c.failed_count} err.</span>}
                              <span title="Total">{c.total_count} total</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted flex overflow-hidden">
                              <div className="h-full bg-success" style={{ width: `${c.total_count > 0 ? (c.sent_count / c.total_count) * 100 : 0}%` }} />
                              <div className="h-full bg-destructive" style={{ width: `${c.total_count > 0 ? (c.failed_count / c.total_count) * 100 : 0}%` }} />
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground font-medium">{progress}% concluído</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-7 w-7" disabled={isPending} />}>
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Ações</span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem render={<a href={`/campaigns/${c.id}`} />}>
                                <Eye className="h-4 w-4 mr-2" /> Ver detalhes
                              </DropdownMenuItem>
                              {c.status === "draft" && (
                                <DropdownMenuItem onClick={() => handleEdit(c.id)} disabled={isPending}>
                                  <Pencil className="h-4 w-4 mr-2" /> Editar
                                </DropdownMenuItem>
                              )}
                              {(c.status === "scheduled" || c.status === "running") && (
                                <DropdownMenuItem onClick={() => handlePause(c.id)}>
                                  <Pause className="h-4 w-4 mr-2" /> Pausar
                                </DropdownMenuItem>
                              )}
                              {c.status === "paused" && (
                                <DropdownMenuItem onClick={() => handleResume(c.id)}>
                                  <Play className="h-4 w-4 mr-2" /> Retomar
                                </DropdownMenuItem>
                              )}
                              {c.status !== "completed" && c.status !== "cancelled" && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => handleCancel(c.id)}
                                >
                                  <X className="h-4 w-4 mr-2" /> Cancelar
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => handleDelete(c)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-primary" />
                  <h2 className="text-sm font-semibold">Saúde do WhatsApp</h2>
                </div>
                <HealthRow
                  label="Instância"
                  value={whatsappStatus.connected ? "Conectada" : "Desconectada"}
                  ok={whatsappStatus.connected}
                />
                {whatsappStatus.provider && (
                  <HealthRow
                    label="Provider"
                    value={whatsappStatus.provider === "meta" ? "Meta Cloud" : "UAZAPI"}
                  />
                )}
                {whatsappStatus.phone && (
                  <HealthRow label="Número" value={whatsappStatus.phone} />
                )}
                <Button variant="secondary" size="sm" className="w-full gap-2">
                  <RefreshCw className="size-4" />
                  Diagnosticar conexão
                </Button>
              </CardContent>
            </Card>

            {whatsappStatus.connected ? (
              <Card className="bg-primary text-primary-foreground">
                <CardContent className="p-5">
                  <p className="font-semibold">Envio seguro ativo</p>
                  <p className="mt-2 text-sm text-primary-foreground/80">
                    Sua conta está usando intervalos humanos e controle de velocidade.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-destructive/30 bg-destructive/5">
                <CardContent className="p-5">
                  <p className="font-semibold text-destructive">WhatsApp desconectado</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Conecte o WhatsApp para poder enviar campanhas.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Wizard */}
      <CrmCampaignWizard
        open={wizardOpen}
        onOpenChange={(v) => {
          setWizardOpen(v);
          if (!v) {
            setEditData(null);
            if (initialEditData) {
              const url = new URL(window.location.href);
              url.searchParams.delete("edit");
              window.history.replaceState({}, "", url);
            }
          }
        }}
        segments={segments}
        tags={tags}
        pipelines={pipelines}
        stages={stages}
        groups={groups}
        initialData={editData}
      />
    </div>
  );
}

function HealthRow({ label, value, ok = false }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={ok ? "font-medium text-success" : "font-medium"}>
        {ok && <span className="mr-1 inline-block size-1.5 rounded-full bg-success align-middle" />}
        {value}
      </span>
    </div>
  );
}
