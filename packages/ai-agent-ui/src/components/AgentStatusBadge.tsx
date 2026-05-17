"use client";

import { Badge } from "@persia/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@persia/ui/tooltip";
import type { AgentStatus } from "@persia/shared/ai-agent";
import { cn } from "@persia/ui/utils";

// PR-AI-AGENT-POLISH (mai/2026): badge ganha tooltip explicativo. Cliente
// leigo entende cores mas nao sabe a diferenca semantica entre rascunho
// e pausado (ambos "nao respondem"). Tooltip clarifica em 1 linha.
const STATUS_LABEL: Record<AgentStatus, string> = {
  active: "Ativo",
  draft: "Rascunho",
  paused: "Pausado",
};

const STATUS_TOOLTIP: Record<AgentStatus, string> = {
  active: "Respondendo conversas novas automaticamente.",
  draft: "Em configuração — ainda não responde mensagens.",
  paused: "Configurado, mas você pausou manualmente.",
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
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5 font-medium cursor-help",
                STATUS_STYLES[status],
              )}
            />
          }
        >
          <span
            className={cn("size-1.5 rounded-full", STATUS_DOT[status])}
            aria-hidden
          />
          {STATUS_LABEL[status]}
        </TooltipTrigger>
        <TooltipContent>{STATUS_TOOLTIP[status]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
