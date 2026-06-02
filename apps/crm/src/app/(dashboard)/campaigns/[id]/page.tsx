import React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageTitle } from "@persia/ui/typography";
import { Badge } from "@persia/ui/badge";
import { RelativeTime } from "@persia/ui/relative-time";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { ArrowLeft, Users, Send, Clock, XCircle, SkipForward } from "lucide-react";
import { requireAdminPageAccess } from "@/lib/guards/require-admin";
import { getCrmCampaignDetails } from "@/actions/crm-campaigns";
import { CrmCampaignActions } from "@/components/campaigns/crm-campaign-actions";
import type { CampaignStatus, CampaignKind } from "@persia/shared/crm";

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

export default async function CampaignDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPageAccess();
  const { id } = await params;
  const campaign = await getCrmCampaignDetails(id);

  if (!campaign) notFound();

  const statusUi = STATUS_UI[campaign.status] ?? { label: campaign.status, variant: "secondary" as const };
  const rc = campaign.recipient_counts;
  const jc = campaign.job_counts;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/campaigns" className="inline-flex items-center justify-center h-8 w-8 mt-0.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
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
        <CrmCampaignActions campaign={campaign} />
      </div>

      {/* Stats */}
      {rc && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <StatCard icon={<Users className="h-4 w-4" />} label="Total" value={rc.total} />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Pendentes" value={rc.pending} />
          <StatCard icon={<Send className="h-4 w-4" />} label="Enviados" value={jc?.sent ?? 0} />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Na fila" value={jc?.queued ?? 0} />
          <StatCard icon={<XCircle className="h-4 w-4" />} label="Falhas" value={jc?.failed ?? 0} />
          <StatCard icon={<SkipForward className="h-4 w-4" />} label="Pulados" value={jc?.skipped ?? 0} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Steps */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Mensagens ({campaign.steps.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {campaign.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma mensagem</p>
            ) : (
              campaign.steps.map((step, i) => (
                <div key={step.id} className="border rounded-md p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs text-muted-foreground">#{i + 1}</span>
                    <span className="text-xs text-muted-foreground">{SEND_MODE_LABEL[step.send_mode] ?? step.send_mode}</span>
                    {step.media_type !== "none" && (
                      <Badge variant="outline" className="text-xs">{step.media_type}</Badge>
                    )}
                  </div>
                  {step.message_text && (
                    <p className="text-muted-foreground line-clamp-2">{step.message_text}</p>
                  )}
                  {step.media_url && (
                    <p className="text-muted-foreground truncate">{step.media_filename ?? step.media_url}</p>
                  )}
                  {step.scheduled_at && (
                    <p className="text-xs text-muted-foreground">
                      Agendado: <RelativeTime iso={step.scheduled_at} />
                    </p>
                  )}
                  {step.delay_amount && step.delay_unit && (
                    <p className="text-xs text-muted-foreground">
                      Aguardar {step.delay_amount} {step.delay_unit}
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Targets + Config */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Público ({campaign.targets.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {campaign.targets.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum público definido</p>
              ) : (
                campaign.targets.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline" className="text-xs">{t.target_kind}</Badge>
                    {t.target_id && <span className="text-muted-foreground truncate">{t.target_id}</span>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Configurações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
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
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-xs">{label}</span></div>
        <span className="text-xl font-semibold">{value}</span>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
