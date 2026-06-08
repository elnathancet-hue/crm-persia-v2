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
    <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 space-y-3 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="size-6 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
          <AlertTriangle className="size-3.5 text-warning" strokeWidth={3} />
        </div>
        <p className="text-sm font-bold text-warning-soft-foreground tracking-tight">
          {active.length === 1
            ? "1 item requer atenção"
            : `${active.length} itens requerem atenção`}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {active.map((alert) => {
          const Icon = alert.icon;
          return (
            <Link
              key={alert.id}
              href={alert.href}
              className="flex items-center justify-between rounded-lg bg-card border border-border/50 shadow-sm px-4 py-3 hover:shadow hover:border-warning/40 transition-all duration-200 group"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "size-8 rounded-lg flex items-center justify-center shrink-0",
                    alert.variant === "error"
                      ? "bg-destructive/10 text-destructive"
                      : alert.variant === "warning"
                        ? "bg-warning/10 text-warning"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" strokeWidth={2} />
                </div>
                <p className="text-sm">
                  <span className="font-bold tabular-nums text-foreground">{alert.count}</span>
                  <span className="text-muted-foreground ml-1.5 font-medium">{alert.label}</span>
                </p>
              </div>
              <div className="size-6 rounded-full bg-transparent flex items-center justify-center opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200">
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
