"use client";

// PR-CRMOPS2: dialog que o "+" da coluna do Kanban abre.
//
// Briefing C: "O '+' da coluna nao deve abrir 'Novo negocio'. Deve abrir
// o formulario de 'Criar lead'. A etapa deve vir pre-selecionada conforme
// a coluna clicada. Ao salvar, o lead precisa aparecer imediatamente
// naquela coluna do Pipeline."
//
// Como funciona:
//   1. Reusa o LeadForm de @persia/leads-ui (mesmo form da tab Leads)
//   2. Salva via actions.createLeadWithDeal (cria lead + deal vinculado
//      na etapa selecionada)
//   3. Dispara onCreated -> pai re-fetcha (router.refresh) -> card aparece
//      no Kanban com nome/telefone/email do lead
//
// Por que NAO faz optimistic update local: o card precisa ter o embed
// `leads(...)` completo (com lead_tags + assignee). Reconstruir esse
// embed no client e fragil — preferimos refresh server pra garantir
// consistencia. Tradeoff: 1 round-trip extra apos o submit.

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { LeadForm } from "@persia/leads-ui";

import { useKanbanActions } from "../context";
import { DialogHero } from "./DialogHero";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  stageId: string;
  /** Nome da etapa pra mostrar no header do dialog. */
  stageName: string;
  /** Disparado apos criar lead+deal. Pai deve re-fetchar (router.refresh). */
  onCreated?: () => void;
}

export function CreateLeadFromKanbanDialog({
  open,
  onOpenChange,
  pipelineId,
  stageId,
  stageName,
  onCreated,
}: Props) {
  const actions = useKanbanActions();

  const handleSubmit = async (formData: FormData) => {
    if (!actions.createLeadWithDeal) {
      // Fallback defensivo (compat com adapters antigos): nao faz nada.
      // Em producao, o adapter do CRM SEMPRE implementa, entao isso
      // nao deve acontecer.
      toast.error("Funcionalidade indisponivel neste contexto.");
      return;
    }

    const name = (formData.get("name") as string)?.trim() || "";
    const phone = (formData.get("phone") as string)?.trim() || null;
    const email = (formData.get("email") as string)?.trim() || null;
    const source = (formData.get("source") as string) || "manual";
    const status = (formData.get("status") as string) || "new";
    const channel = (formData.get("channel") as string) || "whatsapp";

    try {
      await actions.createLeadWithDeal({
        lead: { name, phone, email, source, status, channel },
        pipelineId,
        stageId,
        dealTitle: name,
      });
      toast.success(`Lead adicionado em "${stageName}"`);
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao criar lead";
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Adicionar lead</DialogTitle>
          <DialogHero
            icon={<Plus className="size-5" />}
            title="Adicionar lead"
            tagline={`Sera criado em "${stageName}"`}
          />
        </DialogHeader>
        <LeadForm
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          submitLabel="Criar lead"
        />
      </DialogContent>
    </Dialog>
  );
}
