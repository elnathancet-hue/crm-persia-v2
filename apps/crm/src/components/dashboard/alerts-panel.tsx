import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface DashboardAlert {
  id: string;
  icon: LucideIcon;
  count: number;
  label: string;
  href: string;
  variant: "error" | "warning" | "muted";
}

export function AlertsPanel({ alerts }: { alerts: DashboardAlert[] }) {
  const active = alerts.filter((a) => a.count > 0);
  if (active.length === 0) return null;

  return (
    <div className="rounded-xl border border-warning/30 bg-gradient-to-br from-warning/10 to-transparent p-4 space-y-3 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="size-6 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
          <AlertTriangle className="size-3.5 text-warning" strokeWidth={3} />
        </div>
        <p className="text-sm font-bold text-warning-foreground tracking-tight">
          {active.length === 1
            ? "1 item requer atenção"
            : `${active.length} itens requerem atenção`}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {active.map((alert) => {
          const Icon = alert.icon;
          return (
            <Link
              key={alert.id}
              href={alert.href}
              className="flex items-center justify-between rounded-lg bg-card/60 backdrop-blur-sm border border-border/50 px-4 py-3 hover:bg-card hover:shadow-sm hover:border-warning/30 transition-all duration-300 group"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "size-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm",
                    alert.variant === "error"
                      ? "bg-gradient-to-br from-destructive/20 to-destructive/5 text-destructive"
                      : alert.variant === "warning"
                        ? "bg-gradient-to-br from-warning/20 to-warning/5 text-warning"
                        : "bg-gradient-to-br from-muted to-muted/50 text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" strokeWidth={2.5} />
                </div>
                <p className="text-sm">
                  <span className="font-bold tabular-nums text-foreground">{alert.count}</span>
                  <span className="text-muted-foreground ml-1.5">{alert.label}</span>
                </p>
              </div>
              <div className="size-6 rounded-full bg-background border flex items-center justify-center opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                <ArrowRight className="size-3 text-primary" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
