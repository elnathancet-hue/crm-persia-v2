"use client";

import { useTransition } from "react";
import { Button } from "@persia/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { MoreHorizontal, Pause, Play, X } from "lucide-react";
import type { CrmCampaignWithDetails } from "@persia/shared/crm";
import { pauseCampaign, resumeCampaign, cancelCampaign } from "@/actions/crm-campaigns";

interface Props {
  campaign: CrmCampaignWithDetails;
}

export function CrmCampaignActions({ campaign }: Props) {
  const [isPending, startTransition] = useTransition();
  const { status, id } = campaign;

  const canPause = status === "scheduled" || status === "running";
  const canResume = status === "paused";
  const canCancel = status !== "completed" && status !== "cancelled";

  if (!canPause && !canResume && !canCancel) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={isPending} />}>
        <MoreHorizontal className="h-4 w-4 mr-1.5" /> Ações
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canPause && (
          <DropdownMenuItem onClick={() => startTransition(async () => { await pauseCampaign(id); })}>
            <Pause className="h-4 w-4 mr-2" /> Pausar
          </DropdownMenuItem>
        )}
        {canResume && (
          <DropdownMenuItem onClick={() => startTransition(async () => { await resumeCampaign(id); })}>
            <Play className="h-4 w-4 mr-2" /> Retomar
          </DropdownMenuItem>
        )}
        {canCancel && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              if (!confirm("Cancelar esta campanha? Jobs pendentes serão cancelados.")) return;
              startTransition(async () => { await cancelCampaign(id); });
            }}
          >
            <X className="h-4 w-4 mr-2" /> Cancelar campanha
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
