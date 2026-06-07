import Link from "next/link";
import { AlertTriangle } from "lucide-react";
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
    <div className="rounded-xl border border-warning/30 bg-warning-soft/40 p-4 space-y-2">
      <p className="text-sm font-semibold text-warning flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        {active.length === 1
          ? "1 item requer atenção"
          : `${active.length} itens requerem atenção`}
      </p>

      <div className="space-y-1.5">
        {active.map((alert) => {
          const Icon = alert.icon;
          return (
            <Link
              key={alert.id}
              href={alert.href}
              className="flex items-center justify-between rounded-lg bg-card border px-4 py-3 hover:bg-accent transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "size-8 rounded-lg flex items-center justify-center shrink-0",
                    alert.variant === "error"
                      ? "bg-destructive/10"
                      : alert.variant === "warning"
                        ? "bg-warning-soft"
                        : "bg-muted",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4",
                      alert.variant === "error"
                        ? "text-destructive"
                        : alert.variant === "warning"
                          ? "text-warning"
                          : "text-muted-foreground",
                    )}
                  />
                </div>
                <p className="text-sm">
                  <span className="font-bold tabular-nums">{alert.count}</span>
                  <span className="text-muted-foreground ml-1.5">{alert.label}</span>
                </p>
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors shrink-0 ml-4">
                Ver →
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
