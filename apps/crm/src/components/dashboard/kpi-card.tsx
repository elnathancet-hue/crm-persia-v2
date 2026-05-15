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
}

// PR-DSBASE: usa KpiValue/SectionLabel/MutedHint pra padronizar tipografia
// + tokens semanticos `text-success/failure` no trend (era green-500/red-500).
export function KpiCard({ title, value, description, icon: Icon, trend }: KpiCardProps) {
  return (
    <Card className="border rounded-xl hover:shadow-sm transition-shadow duration-200">
      <CardContent className="p-6">
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
                {trend.positive ? "+" : ""}{trend.value}% vs semana passada
              </p>
            )}
          </div>
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="size-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
