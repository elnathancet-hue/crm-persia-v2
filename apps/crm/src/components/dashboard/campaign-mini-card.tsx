import Link from "next/link";
import { Megaphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { cn } from "@/lib/utils";

export interface CampaignSnapshot {
  id: string;
  name: string;
  status: string;
  sent_count: number;
  total_count: number;
  created_at: string;
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  draft:      { label: "Rascunho",  cls: "text-muted-foreground bg-muted" },
  validating: { label: "Validando", cls: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" },
  scheduled:  { label: "Agendada",  cls: "text-warning bg-warning-soft" },
  running:    { label: "Enviando",  cls: "text-progress bg-progress/10" },
  paused:     { label: "Pausada",   cls: "text-warning bg-warning-soft" },
  completed:  { label: "Concluída", cls: "text-success bg-success/10" },
  cancelled:  { label: "Cancelada", cls: "text-muted-foreground bg-muted" },
  failed:     { label: "Falhou",    cls: "text-destructive bg-destructive/10" },
};

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CampaignMiniCard({ campaign }: { campaign: CampaignSnapshot }) {
  const cfg = STATUS_CFG[campaign.status] ?? STATUS_CFG.draft;
  const pct =
    campaign.total_count > 0
      ? Math.round((campaign.sent_count / campaign.total_count) * 100)
      : 0;

  return (
    <Card className="border rounded-xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-base font-semibold">
              Última Campanha
            </CardTitle>
          </div>
          <Link
            href="/campaigns"
            className="text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
          >
            Ver todas →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium leading-tight">{campaign.name}</p>
          <span
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
              cfg.cls,
            )}
          >
            {cfg.label}
          </span>
        </div>

        {campaign.total_count > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{campaign.sent_count.toLocaleString("pt-BR")} enviados</span>
              <span>{campaign.total_count.toLocaleString("pt-BR")} total</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-right">
              {pct}% enviado
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Criada em {shortDate(campaign.created_at)}
        </p>
      </CardContent>
    </Card>
  );
}
