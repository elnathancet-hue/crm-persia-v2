import { Badge } from "@persia/ui/badge";
import type { AgentStatus } from "@persia/shared/ai-agent";
import { cn } from "@persia/ui/utils";

const STATUS_LABEL: Record<AgentStatus, string> = {
  active: "Ativo",
  draft: "Rascunho",
  paused: "Pausado",
};

const STATUS_STYLES: Record<AgentStatus, string> = {
  active: "bg-success-soft text-success-soft-foreground border-success-ring",
  draft: "bg-warning-soft text-warning-soft-foreground border-warning-ring",
  paused: "bg-muted text-muted-foreground border-border",
};

const STATUS_DOT: Record<AgentStatus, string> = {
  active: "bg-success",
  draft: "bg-warning",
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
