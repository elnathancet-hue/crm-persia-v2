import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { IndexingStatus } from "@persia/shared/ai-agent";
import { Badge } from "@persia/ui/badge";

interface Props {
  status: IndexingStatus;
  error: string | null;
  chunkCount: number;
}

// Filled variant (bg + text-color), not outline-only — gives each state a
// distinct visual weight at a glance. "Em fila" uses a static Clock icon
// so it's clearly different from "Indexando" (animated Loader2).
export function IndexingStatusBadge({ status, error, chunkCount }: Props) {
  if (status === "pending") {
    return (
      <Badge
        variant="outline"
        className="text-xs gap-1 bg-muted/60 text-muted-foreground border-transparent"
      >
        <Clock className="size-3" />
        Em fila
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge
        variant="outline"
        className="text-xs gap-1 bg-primary/10 text-primary border-transparent"
      >
        <Loader2 className="size-3 animate-spin" />
        Indexando
      </Badge>
    );
  }
  if (status === "indexed") {
    return (
      <Badge
        variant="outline"
        className="text-xs gap-1 bg-success-soft text-success-soft-foreground border-transparent"
      >
        <CheckCircle2 className="size-3" />
        Indexada ({chunkCount} chunk{chunkCount === 1 ? "" : "s"})
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-xs gap-1 bg-destructive/10 text-destructive border-transparent"
      title={error ?? undefined}
    >
      <AlertCircle className="size-3" />
      Falhou
    </Badge>
  );
}
