import Link from "next/link";
import {
  UserPlus,
  Trophy,
  XCircle,
  Calendar,
  StickyNote,
  ArrowRight,
  UserCheck,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import type { OrgActivityRow } from "@persia/shared/crm";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Relative time (server-side) ─────────────────────────────────────────────

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `há ${days}d`;
}

// ─── Type config ──────────────────────────────────────────────────────────────

interface TypeCfg {
  label: string;
  icon: LucideIcon;
  colorClass: string;
  bgClass: string;
}

const TYPE_CONFIG: Record<string, TypeCfg> = {
  lead_created: { label: "Lead criado", icon: UserPlus, colorClass: "text-primary", bgClass: "bg-primary/10" },
  deal_won: { label: "Venda ganha", icon: Trophy, colorClass: "text-success", bgClass: "bg-success/10" },
  deal_lost: { label: "Venda perdida", icon: XCircle, colorClass: "text-destructive", bgClass: "bg-destructive/10" },
  appointment_created: { label: "Agendamento criado", icon: Calendar, colorClass: "text-chart-2", bgClass: "bg-chart-2/10" },
  appointment_updated: { label: "Agendamento atualizado", icon: Calendar, colorClass: "text-warning", bgClass: "bg-warning-soft" },
  stage_changed: { label: "Etapa alterada", icon: ArrowRight, colorClass: "text-warning", bgClass: "bg-warning-soft" },
  note_added: { label: "Nota adicionada", icon: StickyNote, colorClass: "text-muted-foreground", bgClass: "bg-muted" },
  assigned: { label: "Atribuído", icon: UserCheck, colorClass: "text-progress", bgClass: "bg-progress/10" },
};

const DEFAULT_CFG: TypeCfg = {
  label: "Atividade",
  icon: Activity,
  colorClass: "text-muted-foreground",
  bgClass: "bg-muted",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ActivityFeed({ activities }: { activities: OrgActivityRow[] }) {
  return (
    <Card className="border rounded-xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Atividade Recente</CardTitle>
          <Link
            href="/crm"
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Ver todas →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-2">
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhuma atividade ainda
          </p>
        ) : (
          <div className="divide-y divide-border">
            {activities.map((act) => {
              const cfg = TYPE_CONFIG[act.type] ?? DEFAULT_CFG;
              const Icon = cfg.icon;
              const leadName =
                act.leads?.name || act.leads?.phone || "Lead desconhecido";
              return (
                <div key={act.id} className="flex items-start gap-3 py-3">
                  <div
                    className={cn(
                      "size-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                      cfg.bgClass,
                    )}
                  >
                    <Icon className={cn("size-3.5", cfg.colorClass)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">
                      <span className="font-medium truncate">{leadName}</span>
                      {act.description && (
                        <span className="text-muted-foreground">
                          {" "}
                          — {act.description}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {cfg.label}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 mt-0.5 tabular-nums">
                    {relativeTime(act.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
