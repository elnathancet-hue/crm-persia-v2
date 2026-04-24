import { Badge } from "@persia/ui/badge";
import type { AgentStatus } from "@persia/shared/ai-agent";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<AgentStatus, string> = {
  active: "Ativo",
  draft: "Rascunho",
  paused: "Pausado",
};

const STATUS_STYLES: Record<AgentStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  paused: "bg-muted text-muted-foreground border-border",
};

const STATUS_DOT: Record<AgentStatus, string> = {
  active: "bg-emerald-500",
  draft: "bg-amber-500",
  paused: "bg-muted-foreground/60",
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", STATUS_STYLES[status])}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}
