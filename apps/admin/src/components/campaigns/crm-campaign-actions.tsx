"use client";

import { useState, useTransition } from "react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@persia/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { MoreHorizontal, Pause, Play, X, Trash2, Copy, Send } from "lucide-react";
import type { CrmCampaignWithDetails } from "@persia/shared/crm";
import { pauseCampaign, resumeCampaign, cancelCampaign, deleteCrmCampaign, duplicateCrmCampaign, sendCampaignTestMessage } from "@/actions/crm-campaigns";

interface Props {
  campaign: CrmCampaignWithDetails;
}

export function CrmCampaignActions({ campaign }: Props) {
  const [isPending, startTransition] = useTransition();
  const [testOpen, setTestOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testFeedback, setTestFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const { status, id } = campaign;

  const canPause = status === "scheduled" || status === "running";
  const canResume = status === "paused";
  const canCancel = status !== "completed" && status !== "cancelled";
  const canDelete = status !== "scheduled" && status !== "running";

  if (!canPause && !canResume && !canCancel && !canDelete) return null;

  function handleTestSubmit() {
    const cleanPhone = testPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      setTestFeedback({ type: "error", message: "Informe um número com DDI e DDD." });
      return;
    }

    setTestFeedback(null);
    startTransition(async () => {
      const result = await sendCampaignTestMessage(id, cleanPhone);
      if (result && "error" in result) {
        setTestFeedback({ type: "error", message: result.error ?? "Erro ao testar" });
      } else {
        setTestFeedback({ type: "success", message: "Teste enviado. Verifique o WhatsApp em alguns segundos." });
      }
    });
  }

  return (
    <>
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
          <DropdownMenuItem
            onClick={() => {
              startTransition(async () => {
                const result = await duplicateCrmCampaign(id);
                if (result && "error" in result) {
                  alert(result.error ?? "Erro ao duplicar");
                } else if (result && "data" in result && result.data) {
                  // Redireciona com ?edit=ID para abrir o Wizard
                  window.location.href = `/campaigns?edit=${result.data}`;
                }
              });
            }}
          >
            <Copy className="h-4 w-4 mr-2" /> Duplicar Campanha
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setTestFeedback(null);
              setTestOpen(true);
            }}
          >
            <Send className="h-4 w-4 mr-2" /> Testar no meu número
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Enviar teste</DialogTitle>
            <DialogDescription>
              Envie a primeira sequência desta campanha para um número interno antes de agendar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`campaign-test-phone-${id}`}>WhatsApp com DDI</Label>
            <Input
              id={`campaign-test-phone-${id}`}
              name="campaign_test_phone"
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
              placeholder="Ex: 558699421406"
              inputMode="tel"
            />
            {testFeedback && (
              <p className={`text-sm font-medium ${testFeedback.type === "success" ? "text-success" : "text-destructive"}`}>
                {testFeedback.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)} disabled={isPending}>
              Fechar
            </Button>
            <Button onClick={handleTestSubmit} disabled={isPending || testPhone.trim().length === 0}>
              <Send className="h-4 w-4 mr-2" /> Enviar teste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
