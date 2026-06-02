"use client";

import { useTransition } from "react";
import { Button } from "@persia/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { MoreHorizontal, Pause, Play, X, Trash2 } from "lucide-react";
import type { CrmCampaignWithDetails } from "@persia/shared/crm";
import { pauseCampaign, resumeCampaign, cancelCampaign, deleteCrmCampaign } from "@/actions/crm-campaigns";

interface Props {
  campaign: CrmCampaignWithDetails;
}

export function CrmCampaignActions({ campaign }: Props) {
  const [isPending, startTransition] = useTransition();
  const { status, id } = campaign;

  const canPause = status === "scheduled" || status === "running";
  const canResume = status === "paused";
  const canCancel = status !== "completed" && status !== "cancelled";
  const canDelete = status !== "scheduled" && status !== "running";

  if (!canPause && !canResume && !canCancel && !canDelete) return null;

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
        {canDelete && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              if (!confirm(`Excluir a campanha "${campaign.name}"? Esta ação remove histórico, destinatários e jobs.`)) return;
              startTransition(async () => {
                const result = await deleteCrmCampaign(id);
                if (result && "error" in result) {
                  alert(result.error ?? "Erro ao excluir campanha");
                  return;
                }
                window.location.href = "/campaigns";
              });
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Excluir campanha
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
