import { Card, CardContent } from "@persia/ui/card";
import { KpiValue, MutedHint, SectionLabel } from "@persia/ui/typography";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  trend?: { value: number; positive: boolean };
  variant?: "default" | "warning";
}

// PR-DSBASE: usa KpiValue/SectionLabel/MutedHint pra padronizar tipografia
// + tokens semanticos `text-success/failure` no trend (era green-500/red-500).
export function KpiCard({ title, value, description, icon: Icon, trend, variant = "default" }: KpiCardProps) {
  return (
    <Card className="border rounded-xl hover:shadow-sm transition-shadow duration-200">
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <SectionLabel as="p">{title}</SectionLabel>
            <KpiValue size="lg">{value}</KpiValue>
            {description && <MutedHint>{description}</MutedHint>}
            {trend && (
              <p
                className={cn(
                  "text-xs font-medium",
                  trend.positive ? "text-success" : "text-failure",
                )}
              >
                {trend.positive ? "↑" : "↓"} {trend.value}% vs período anterior
              </p>
            )}
          </div>
          <div className={cn(
            "size-10 rounded-xl flex items-center justify-center shrink-0",
            variant === "warning" ? "bg-warning-soft" : "bg-primary/10"
          )}>
            <Icon className={cn("size-5", variant === "warning" ? "text-warning" : "text-primary")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
