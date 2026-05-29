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
import { Loader2, Plus, Search, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@persia/ui/tabs";
import { LeadForm } from "@persia/leads-ui";

import { useKanbanActions } from "../context";
import { DialogHero } from "./DialogHero";

type SearchResult = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  current_pipeline_id: string | null;
  current_pipeline_name: string | null;
  current_stage_id: string | null;
  current_stage_name: string | null;
};

const SEARCH_DEBOUNCE_MS = 300;

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
    // PR-K-CENTRIC (mai/2026): cria so o LEAD em pipeline/stage.
    // Deal nao e mais criado automaticamente (vira opt-in no drawer).
    // Fallback no createLeadWithDeal legacy se adapter nao tiver
    // createLeadInPipeline (compat ate Fase 5).
    const useLeadCentric = Boolean(actions.createLeadInPipeline);
    const useLegacy = Boolean(actions.createLeadWithDeal);
    if (!useLeadCentric && !useLegacy) {
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
      if (useLeadCentric) {
        await actions.createLeadInPipeline!({
          lead: { name, phone, email, source, status, channel },
          pipelineId,
          stageId,
        });
      } else {
        await actions.createLeadWithDeal!({
          lead: { name, phone, email, source, status, channel },
          pipelineId,
          stageId,
          dealTitle: name,
        });
      }
      toast.success(`Lead adicionado em "${stageName}"`);
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao criar lead";
      toast.error(msg);
    }
  };

  const canSearchExisting = Boolean(actions.searchLeadsForKanban);
  const canMoveExisting = Boolean(actions.moveLeadToPipeline);
  const showExistingTab = canSearchExisting && canMoveExisting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Adicionar lead</DialogTitle>
          <DialogHero
            icon={<Plus className="size-5" />}
            title="Adicionar lead"
            tagline={`Sera adicionado em "${stageName}"`}
          />
        </DialogHeader>

        {showExistingTab ? (
          <Tabs defaultValue="new" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="new">Novo lead</TabsTrigger>
              <TabsTrigger value="existing">Selecionar existente</TabsTrigger>
            </TabsList>
            <TabsContent value="new" className="mt-4">
              <LeadForm
                onSubmit={handleSubmit}
                onCancel={() => onOpenChange(false)}
                submitLabel="Criar lead"
              />
            </TabsContent>
            <TabsContent value="existing" className="mt-4">
              <ExistingLeadPicker
                pipelineId={pipelineId}
                stageId={stageId}
                stageName={stageName}
                onCancel={() => onOpenChange(false)}
                onAdded={() => {
                  onOpenChange(false);
                  onCreated?.();
                }}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <LeadForm
            onSubmit={handleSubmit}
            onCancel={() => onOpenChange(false)}
            submitLabel="Criar lead"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// ExistingLeadPicker — aba "Selecionar existente" do Kanban "+".
// Cliente busca lead por nome/telefone/email, ve em qual funil ele
// esta hoje (se algum) e adiciona/move pra esta etapa.
//
// mai/2026: Cliente reportou que leads vindos por WhatsApp/import
// ficavam orfaos do Kanban — so dava pra criar lead novo. Picker
// resolve o gap reusando o moveLeadToPipeline ja existente.
// ============================================================

interface ExistingLeadPickerProps {
  pipelineId: string;
  stageId: string;
  stageName: string;
  onCancel: () => void;
  onAdded: () => void;
}

function ExistingLeadPicker({
  pipelineId,
  stageId,
  stageName,
  onCancel,
  onAdded,
}: ExistingLeadPickerProps) {
  const actions = useKanbanActions();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Debounce: evita 1 request por keystroke. Cancela busca anterior
  // quando user continua digitando.
  React.useEffect(() => {
    if (!actions.searchLeadsForKanban) return;
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await actions.searchLeadsForKanban!(query, 20);
        setResults(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao buscar";
        toast.error(msg);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, actions]);

  const selectedLead = results.find((r) => r.id === selectedId);
  const isAlreadyHere =
    selectedLead?.current_stage_id === stageId &&
    selectedLead?.current_pipeline_id === pipelineId;

  async function handleAdd() {
    if (!selectedLead || !actions.moveLeadToPipeline) return;
    if (isAlreadyHere) {
      toast.info("Esse lead ja esta nesta etapa.");
      return;
    }
    setSubmitting(true);
    try {
      await actions.moveLeadToPipeline(selectedLead.id, pipelineId, stageId);
      toast.success(`Lead movido pra "${stageName}"`);
      onAdded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao mover lead";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, telefone ou e-mail..."
          className="pl-9"
        />
      </div>

      <div className="min-h-[200px] max-h-[300px] overflow-y-auto rounded-md border border-border">
        {searching ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            Buscando...
          </div>
        ) : query.trim().length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <User className="size-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              Digite o nome, telefone ou e-mail do lead que você quer
              adicionar a esta etapa.
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <p className="text-sm text-muted-foreground">
              Nenhum lead encontrado com &quot;{query}&quot;.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Tenta a aba &quot;Novo lead&quot; pra criar.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {results.map((lead) => {
              const isSelected = lead.id === selectedId;
              const alreadyInThisStage =
                lead.current_stage_id === stageId &&
                lead.current_pipeline_id === pipelineId;
              return (
                <li key={lead.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(lead.id)}
                    disabled={alreadyInThisStage}
                    className={`w-full text-left px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      isSelected
                        ? "bg-primary/10 border-l-2 border-primary"
                        : "hover:bg-muted/50 border-l-2 border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="size-8 shrink-0 rounded-full bg-muted flex items-center justify-center">
                        <User className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {lead.name || "(sem nome)"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {lead.phone || lead.email || "(sem contato)"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-1.5 text-[11px] text-muted-foreground pl-10">
                      {alreadyInThisStage ? (
                        <span className="text-success font-medium">
                          ✓ Já está nesta etapa
                        </span>
                      ) : lead.current_pipeline_name ? (
                        <>
                          No funil:{" "}
                          <span className="font-medium text-foreground">
                            {lead.current_pipeline_name} ›{" "}
                            {lead.current_stage_name || "—"}
                          </span>
                          <span className="text-muted-foreground/70">
                            {" "}
                            (será movido pra cá)
                          </span>
                        </>
                      ) : (
                        <span className="italic">Sem funil — será adicionado aqui</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={handleAdd}
          disabled={!selectedId || submitting || isAlreadyHere}
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin mr-1" />
              Adicionando...
            </>
          ) : (
            "Adicionar a esta etapa"
          )}
        </Button>
      </div>
    </div>
  );
}
