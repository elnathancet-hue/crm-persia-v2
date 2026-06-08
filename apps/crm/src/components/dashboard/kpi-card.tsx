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

export function KpiCard({ title, value, description, icon: Icon, trend, variant = "default" }: KpiCardProps) {
  return (
    <Card className="group relative overflow-hidden bg-card rounded-xl hover:shadow-md transition-all duration-300 border-border/60">
      <CardContent className="p-5 md:p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2 z-10">
            <SectionLabel as="p" className="text-muted-foreground/80 tracking-wide uppercase text-[10px] font-bold">
              {title}
            </SectionLabel>
            <div className="flex items-baseline gap-2">
              <KpiValue size="lg" className="tracking-tight text-foreground">{value}</KpiValue>
            </div>
            {description && <MutedHint className="text-xs">{description}</MutedHint>}
            {trend && (
              <div className="flex items-center gap-1.5 mt-2">
                <span
                  className={cn(
                    "inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[10px] font-bold tracking-wider",
                    trend.positive 
                      ? "bg-success/10 text-success" 
                      : "bg-failure/10 text-failure"
                  )}
                >
                  {trend.positive ? "↑" : "↓"} {trend.value}%
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">vs período anterior</span>
              </div>
            )}
          </div>
          <div className={cn(
            "size-12 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-105",
            variant === "warning" 
              ? "bg-warning/10 text-warning" 
              : "bg-primary/10 text-primary"
          )}>
            <Icon className="size-5" strokeWidth={2} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
