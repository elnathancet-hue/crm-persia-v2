"use client";

// Drawer "Informacoes do lead" — abre dentro do /crm e /leads sem
// navegar pra rota separada. Espelha o design da referencia (Fase 2):
// header com etapa atual clicavel, 3 tabs (Dados/Produtos/Comentarios),
// e secoes CONTATO + ENDERECO + ANOTACOES dentro de Dados.
//
// Tabs Produtos e Comentarios ficam vazios por ora — Fase 4 adiciona
// schema (lead_products, lead_comments).

import * as React from "react";
import { toast } from "sonner";
import {
  Contact,
  MapPin,
  StickyNote,
  Loader2,
  Save,
  ChevronDown,
  CircleDollarSign,
  MessageCircle,
  Activity as ActivityIcon,
  Briefcase,
  ExternalLink,
  Pencil,
  Trash2,
  Send,
  MessageSquare,
  // PR-B11: icones pra secao TAGS
  Tag as TagIcon,
  Plus,
  X,
} from "lucide-react";
import type { LeadWithTags, StageOutcome } from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  useDialogMutation,
  RelativeTime,
  formatRelativeShortPtBR,
} from "@persia/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@persia/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@persia/ui/popover";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@persia/ui/tabs";
// PR-U2: actions vem via useLeadsActions() (DI). Hooks de realtime
// foram extraidos pro mesmo pacote.
import type {
  LeadCustomFieldDef,
  LeadCustomFieldEntry,
  LeadDealItem,
  LeadStats,
} from "../actions";
import { useLeadsActions } from "../context";
import { LeadCommentsTab } from "./LeadCommentsTab";
import { useCurrentUser } from "../hooks/use-current-user";
import { useLeadPresence } from "../hooks/use-lead-presence";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Switch } from "@persia/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";

// Buckets pra agrupar stages no Popover do subheader. Espelha o
// schema de outcome (Fase 1) e as cores usadas no Kanban.
//
// PR-DSBASE (mai/2026): cores migradas pra tokens semanticos. Cada
// outcome mapeia pra `text-progress|failure|success` que resolvem
// light/dark via CSS vars.
const OUTCOME_LABEL: Record<StageOutcome, string> = {
  em_andamento: "EM ANDAMENTO",
  falha: "FALHA",
  bem_sucedido: "BEM-SUCEDIDO",
};
const OUTCOME_COLOR: Record<StageOutcome, string> = {
  em_andamento: "text-progress",
  falha: "text-failure",
  bem_sucedido: "text-success",
};

interface DrawerStage {
  id: string;
  name: string;
  color: string;
  outcome: StageOutcome;
  sort_order: number;
}

type Stage = { id: string; name: string };
type Member = { user_id: string; name: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadWithTags;
  /** Nome da etapa atual do lead (etapa do deal aberto, se houver). */
  currentStageName?: string | null;
  /** Membros do org pra dropdown "Responsável". */
  members?: Member[];
  /** Lista das stages disponiveis pra trocar (futuro). */
  stages?: Stage[];
  /** Callback apos salvar com sucesso (parent re-busca/sincroniza). */
  onSaved?: (updated: Partial<LeadWithTags>) => void;
  /**
   * PR-U2: supabase client injetado pelo caller (DI). Usado por
   * useCurrentUser + useLeadPresence (realtime). CRM passa
   * createClient(); admin passa getSupabaseBrowserClient().
   */
  supabase: SupabaseClient;
  /**
   * PR-U3: gates de role injetados pelo caller. Regra do projeto:
   * pacote NUNCA consome useRole/useActiveOrg — caller resolve.
   *   - canEdit (default true): habilita Salvar + inputs editaveis
   *   - canDelete (default false): mostra botao "Excluir" no footer
   *     com AlertDialog. CRM: isAgent. Admin: superadmin (true).
   */
  canEdit?: boolean;
  canDelete?: boolean;
  /** Callback chamado apos deletar com sucesso (parent fecha drawer
   *  + refetch lista). Recebe o leadId deletado. */
  onDeleted?: (leadId: string) => void;
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  // Telefone fixo: separamos do `phone` (whatsapp) — armazenado em
  // metadata.landline pra nao impactar campanhas WhatsApp.
  landline: string;
  assigned_to: string;
  website: string;
  address_country: string;
  address_state: string;
  address_city: string;
  address_zip: string;
  address_street: string;
  address_number: string;
  address_neighborhood: string;
  address_complement: string;
  notes: string;
}

function leadToFormState(lead: LeadWithTags): FormState {
  const meta = (lead.metadata ?? {}) as Record<string, unknown>;
  return {
    name: lead.name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    landline:
      typeof meta.landline === "string" ? (meta.landline as string) : "",
    assigned_to: lead.assigned_to ?? "",
    website: lead.website ?? "",
    address_country: lead.address_country ?? "",
    address_state: lead.address_state ?? "",
    address_city: lead.address_city ?? "",
    address_zip: lead.address_zip ?? "",
    address_street: lead.address_street ?? "",
    address_number: lead.address_number ?? "",
    address_neighborhood: lead.address_neighborhood ?? "",
    address_complement: lead.address_complement ?? "",
    notes: lead.notes ?? "",
  };
}

export function LeadInfoDrawer({
  open,
  onOpenChange,
  lead,
  currentStageName,
  members = [],
  onSaved,
  supabase,
  canEdit = true,
  canDelete = false,
  onDeleted,
}: Props) {
  // PR-U2: actions vem do provider via DI. Cada app injeta sua versao
  // (CRM: requireRole; admin: requireSuperadminForOrg).
  const actions = useLeadsActions();
  const [form, setForm] = React.useState<FormState>(() =>
    leadToFormState(lead),
  );

  // PR-U3: state pra exclusao. AlertDialog controlled via state pra
  // que o handler de deletar consiga fechar + chamar onDeleted.
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  // PR-B11 (auditoria E2E 2026-05-13, bug #15): tags no drawer.
  // Antes o drawer NAO tinha controle de tags — usuario precisava
  // navegar pra pagina legacy /leads/[id] pra adicionar/remover.
  // Agora reusa actions.addTagToLead/removeTagFromLead + getOrgTags
  // (ja existentes no LeadsActions, wired em CRM e admin).
  const [orgTags, setOrgTags] = React.useState<
    Array<{ id: string; name: string; color: string }>
  >([]);
  const [tagPending, setTagPending] = React.useState<string | null>(null);
  const currentTags = React.useMemo(
    () =>
      ((lead as { lead_tags?: Array<{ tag_id: string; tags: { id: string; name: string; color: string } | null }> })
        .lead_tags ?? [])
        .map((lt) => lt.tags)
        .filter(
          (t): t is { id: string; name: string; color: string } => !!t,
        ),
    [lead],
  );
  const currentTagIds = React.useMemo(
    () => new Set(currentTags.map((t) => t.id)),
    [currentTags],
  );
  const availableTags = React.useMemo(
    () => orgTags.filter((t) => !currentTagIds.has(t.id)),
    [orgTags, currentTagIds],
  );

  // Lazy-fetch orgTags na primeira vez que o drawer abre (cache local).
  React.useEffect(() => {
    if (!open || !actions.getOrgTags || orgTags.length > 0) return;
    let cancelled = false;
    actions
      .getOrgTags()
      .then((tags) => {
        if (cancelled) return;
        setOrgTags(
          tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
        );
      })
      .catch(() => {
        /* silencioso — drawer continua funcional sem add tag */
      });
    return () => {
      cancelled = true;
    };
  }, [open, actions, orgTags.length]);

  // Sprint 3d: actions agora retornam ActionResult { data, error } | void.
  // tagPending continua sendo por-tag pra UI (loading state na chip),
  // entao useDialogMutation nao seria ideal aqui — manter try com
  // checagem de result.error.
  async function handleAddTag(tagId: string) {
    if (!actions.addTagToLead || tagPending) return;
    setTagPending(tagId);
    const result = await actions.addTagToLead(lead.id, tagId);
    setTagPending(null);
    if (result && "error" in result && result.error) {
      toast.error(result.error, { id: `lead-${lead.id}-tag-${tagId}` });
      return;
    }
    toast.success("Tag adicionada", {
      id: `lead-${lead.id}-tag-${tagId}`,
      duration: 5000,
    });
    onSaved?.({});
  }

  async function handleRemoveTag(tagId: string) {
    if (!actions.removeTagFromLead || tagPending) return;
    setTagPending(tagId);
    const result = await actions.removeTagFromLead(lead.id, tagId);
    setTagPending(null);
    if (result && "error" in result && result.error) {
      toast.error(result.error, { id: `lead-${lead.id}-tag-${tagId}` });
      return;
    }
    toast.success("Tag removida", {
      id: `lead-${lead.id}-tag-${tagId}`,
      duration: 5000,
    });
    onSaved?.({});
  }

  // Sprint 3b: mutation padronizada com useDialogMutation.
  // Antes: try/catch + setIsDeleting + setOpen manual + tela branca se
  // action lancasse (sem ActionResult).
  // Agora: dialog fecha automatico apos sucesso, toast com id estavel,
  // erro vira toast.error com mensagem PT-BR.
  const deleteMutation = useDialogMutation<void, { success: true }>({
    mutation: async () => {
      if (!actions.deleteLead) {
        return { error: "Ação indisponível neste app" };
      }
      return actions.deleteLead(lead.id);
    },
    onOpenChange: (o) => {
      // Fecha tanto o AlertDialog (delete) quanto o Dialog principal no sucesso.
      if (!o) {
        setDeleteDialogOpen(false);
        onOpenChange(false);
      }
    },
    successToast: "Lead excluído",
    errorToast: (err) => err,
    toastId: `lead-delete-${lead.id}`,
    onSuccess: () => onDeleted?.(lead.id),
  });

  function handleDelete() {
    deleteMutation.run(undefined);
  }
  const isDeleting = deleteMutation.pending;

  // Subheader "Etapa atual" — busca o deal aberto + stages do pipeline
  // ao abrir, pra trocar etapa via Popover sem fechar o drawer (#2 do
  // polish do Kanban). currentStageName (prop) ainda eh suportada como
  // fallback caso o caller queira display estatico.
  const [currentDeal, setCurrentDeal] = React.useState<{
    id: string;
    pipeline_id: string;
    stage_id: string;
  } | null>(null);
  const [drawerStages, setDrawerStages] = React.useState<DrawerStage[]>([]);
  const [stageChangePending, setStageChangePending] = React.useState(false);

  // PR-D: stats do lead pros 3 cards do header (Negocios / Conversas /
  // Atividades). Carregado em paralelo ao deal+stages, sem bloquear o
  // form. Se a query falhar, cards mostram "—" mas o drawer abre normal.
  const [stats, setStats] = React.useState<LeadStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);

  // PR-P Realtime: presence + comments num canal so. Quando outro
  // agente abre o mesmo lead, vira watcher visivel no header. Quando
  // alguem comenta/edita/deleta, dispara bump na tab Comentarios.
  // PR-U2: supabase injetado via prop (DI).
  const currentUser = useCurrentUser(supabase);
  const [commentsBump, setCommentsBump] = React.useState(0);
  const { watchers, othersCount } = useLeadPresence({
    supabase,
    leadId: open ? lead.id : null,
    currentUser,
    onCommentEvent: () => setCommentsBump((v) => v + 1),
  });

  // Re-hidrata o form quando trocar de lead ou reabrir.
  React.useEffect(() => {
    if (open) setForm(leadToFormState(lead));
  }, [open, lead]);

  // Busca deal aberto + stages quando abrir.
  React.useEffect(() => {
    if (!open || !actions.getLeadOpenDealWithStages) return;
    let cancelled = false;
    actions
      .getLeadOpenDealWithStages(lead.id)
      .then((res) => {
        if (cancelled) return;
        if (res) {
          setCurrentDeal(res.deal);
          setDrawerStages(res.stages as DrawerStage[]);
        } else {
          setCurrentDeal(null);
          setDrawerStages([]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentDeal(null);
          setDrawerStages([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, lead.id, actions]);

  // PR-D: busca stats do lead em paralelo (Negocios + Conversas + Activities).
  // Falha silenciosa — cards mostram "—" se nao conseguir carregar.
  React.useEffect(() => {
    if (!open || !actions.getLeadStats) return;
    let cancelled = false;
    setStatsLoading(true);
    actions
      .getLeadStats(lead.id)
      .then((res) => {
        if (!cancelled) setStats(res);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, lead.id, actions]);

  // Sprint 3d: updateDealStage retorna ActionResult — checamos result.error
  // e revertemos UI otimista em caso de erro. Mantemos manual em vez de
  // useDialogMutation porque ha rollback otimista local especifico.
  async function handleChangeStage(newStageId: string) {
    if (!currentDeal || newStageId === currentDeal.stage_id) return;
    if (!actions.updateDealStage) {
      toast.error("Ação indisponível neste app");
      return;
    }
    const previousStageId = currentDeal.stage_id;
    setCurrentDeal({ ...currentDeal, stage_id: newStageId });
    setStageChangePending(true);
    const result = await actions.updateDealStage(currentDeal.id, newStageId);
    setStageChangePending(false);
    if (result && "error" in result && result.error) {
      // Revert
      setCurrentDeal((prev) =>
        prev ? { ...prev, stage_id: previousStageId } : prev,
      );
      toast.error(result.error, {
        id: `deal-stage-${currentDeal.id}`,
        duration: 5000,
      });
      return;
    }
    toast.success("Etapa atualizada", {
      id: `deal-stage-${currentDeal.id}`,
      duration: 5000,
    });
  }

  // Stages agrupadas por outcome pra renderizar no Popover (3 grupos
  // coloridos, igual o Kanban).
  const stagesByOutcome = React.useMemo(() => {
    const groups: Record<StageOutcome, DrawerStage[]> = {
      em_andamento: [],
      falha: [],
      bem_sucedido: [],
    };
    for (const s of drawerStages) groups[s.outcome].push(s);
    for (const k of Object.keys(groups) as StageOutcome[]) {
      groups[k].sort((a, b) => a.sort_order - b.sort_order);
    }
    return groups;
  }, [drawerStages]);

  const currentStageObj = React.useMemo(
    () =>
      currentDeal
        ? drawerStages.find((s) => s.id === currentDeal.stage_id) ?? null
        : null,
    [currentDeal, drawerStages],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Sprint 3b: mutation padronizada com useDialogMutation.
  // Antes: useTransition + try/catch + toast manual + setOpen manual.
  // Agora: dialog fecha automatico, toast com id estavel + duration via
  // helper, erro PT-BR vai pro toast.
  type UpdateLeadPayload = {
    name: string | null;
    email: string | null;
    phone: string | null;
    assigned_to: string | null;
    website: string | null;
    address_country: string | null;
    address_state: string | null;
    address_city: string | null;
    address_zip: string | null;
    address_street: string | null;
    address_number: string | null;
    address_neighborhood: string | null;
    address_complement: string | null;
    notes: string | null;
  };

  const updateMutation = useDialogMutation<UpdateLeadPayload, { id: string }>({
    mutation: async (payload) => {
      if (!actions.updateLead) {
        return { error: "Ação indisponível neste app" };
      }
      return actions.updateLead(lead.id, payload);
    },
    onOpenChange,
    successToast: "Lead atualizado",
    errorToast: (err) => err,
    toastId: `lead-update-${lead.id}`,
    onSuccess: () => {
      onSaved?.({
        name: form.name,
        phone: form.phone,
        email: form.email,
        assigned_to: form.assigned_to || null,
        website: form.website || null,
        address_country: form.address_country || null,
        address_state: form.address_state || null,
        address_city: form.address_city || null,
        address_zip: form.address_zip || null,
        address_street: form.address_street || null,
        address_number: form.address_number || null,
        address_neighborhood: form.address_neighborhood || null,
        address_complement: form.address_complement || null,
        notes: form.notes || null,
      });
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.run({
      name: form.name || null,
      email: form.email || null,
      phone: form.phone || null,
      assigned_to: form.assigned_to || null,
      website: form.website || null,
      address_country: form.address_country || null,
      address_state: form.address_state || null,
      address_city: form.address_city || null,
      address_zip: form.address_zip || null,
      address_street: form.address_street || null,
      address_number: form.address_number || null,
      address_neighborhood: form.address_neighborhood || null,
      address_complement: form.address_complement || null,
      notes: form.notes || null,
    });
  }
  const isPending = updateMutation.pending;

  return (
    // Frente B (UX produto-first): drawer lateral migrou pra Dialog
    // centralizado responsivo. Critérios:
    //   - Centralizado (não lateral)
    //   - Responsivo (max-w escalável: 92vw mobile, 4xl desktop)
    //   - Scroll interno (max-h-[92vh] + flex column + body overflow-y-auto)
    //   - Rounded-2xl pra acabamento DesignFlow
    //   - p-0 + flex column pra header/body/footer fixos com body scrollavel
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[92vw] sm:max-w-4xl max-h-[92vh] overflow-hidden p-0 flex flex-col rounded-2xl gap-0"
      >
        <DialogHeader className="px-6 pt-5 pb-3 pr-12 border-b border-border bg-card shrink-0">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle>Informações do lead</DialogTitle>
            <PresenceAvatars
              watchers={watchers}
              othersCount={othersCount}
              currentUserId={currentUser?.user_id ?? null}
            />
          </div>
          {currentStageObj ? (
            <DialogDescription className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Etapa atual:</span>
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      disabled={stageChangePending}
                      className="inline-flex items-center gap-1 font-medium text-cyan-600 hover:text-cyan-700 hover:underline transition-colors"
                    />
                  }
                >
                  <span>{currentStageObj.name}</span>
                  <ChevronDown className="size-3" />
                </PopoverTrigger>
                <PopoverContent className="w-56 p-1" align="start">
                  {(["em_andamento", "falha", "bem_sucedido"] as StageOutcome[]).map(
                    (outcome) => {
                      const list = stagesByOutcome[outcome];
                      if (list.length === 0) return null;
                      return (
                        <div key={outcome} className="py-1">
                          <p
                            className={`px-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider ${OUTCOME_COLOR[outcome]}`}
                          >
                            {OUTCOME_LABEL[outcome]}
                          </p>
                          {list.map((s) => {
                            const isActive = s.id === currentDeal?.stage_id;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => handleChangeStage(s.id)}
                                disabled={stageChangePending || isActive}
                                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-xs text-left hover:bg-muted/60 transition-colors ${
                                  isActive ? "bg-muted/40 font-medium" : ""
                                }`}
                              >
                                <span className="truncate">{s.name}</span>
                                {isActive ? (
                                  <span
                                    className="size-2 rounded-full"
                                    style={{ backgroundColor: s.color }}
                                  />
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      );
                    },
                  )}
                </PopoverContent>
              </Popover>
            </DialogDescription>
          ) : currentStageName ? (
            // Fallback display estatico (caller pode ainda passar
            // currentStageName mesmo sem deal aberto — ex: contexto
            // sem permissao de edicao).
            <DialogDescription className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Etapa atual:</span>
              <span className="font-medium text-cyan-600">
                {currentStageName}
              </span>
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {/* PR-D: header rico — 3 cards de stats (Negocios / Conversas /
            Atividades). Mostram count + info "de uma olhada" pro agente
            entender historico do lead sem trocar de tab/pagina. */}
        <LeadStatsCards stats={stats} loading={statsLoading} />

        <Tabs defaultValue="dados" className="flex-1 flex flex-col min-h-0">
          {/* PR-L2: 4 tabs (era 3). Tab "Negócios" lista deals do lead
              — modelo conceitual "1 lead -> N negocios" (briefing user).
              Mobile: 2 cols (2 linhas); Desktop: 4 cols (1 linha). */}
          <TabsList className="mx-5 mt-3 grid grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="dados">
              <Contact className="size-4" />
              Dados
            </TabsTrigger>
            {/* PR-L2: tab "Negócios" — modelo "1 lead -> N negocios" */}
            <TabsTrigger value="negocios">
              <Briefcase className="size-4" />
              Negócios
            </TabsTrigger>
            {/* PR-E: tab "Produtos" virou "Campos" — renderizacao
                dinamica dos custom_fields da org. Quando user
                implementar produtos depois, vira tab proprio. */}
            <TabsTrigger value="campos">
              <span className="size-4 inline-flex items-center justify-center">
                ⚙
              </span>
              Campos
            </TabsTrigger>
            <TabsTrigger value="comentarios">
              <span className="size-4 inline-flex items-center justify-center">
                💬
              </span>
              Comentários
            </TabsTrigger>
          </TabsList>

          <form
            id="lead-info-form"
            onSubmit={handleSave}
            className="flex-1 overflow-y-auto px-6 py-4 space-y-6"
          >
            <TabsContent value="dados" className="space-y-6 mt-0">
              {/* ============ CONTATO ============ */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Contact className="size-4 text-cyan-600" />
                  CONTATO
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* PR-B1: name= em todos os inputs do drawer pra
                      melhorar a11y (label association via for/id pareados)
                      e desligar autofill cross-contamination dos
                      password managers (cada campo tem prefix "lead_"). */}
                  <Field label="Nome">
                    <Input
                      name="lead_name"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Nome do contato"
                    />
                  </Field>
                  <Field label="E-mail">
                    <Input
                      name="lead_email"
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="email@exemplo.com"
                    />
                  </Field>
                  <Field label="Celular">
                    <Input
                      name="lead_phone"
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      placeholder="+55 (00) 00000-0000"
                    />
                  </Field>
                  <Field label="Telefone">
                    <Input
                      name="lead_landline"
                      value={form.landline}
                      onChange={(e) => set("landline", e.target.value)}
                      placeholder="(00) 3000-0000"
                    />
                  </Field>
                  <Field label="Responsável">
                    <Select
                      value={form.assigned_to || ""}
                      onValueChange={(v) => set("assigned_to", v ?? "")}
                    >
                      <SelectTrigger className="w-full">
                        {/*
                          PR-B6: mostra o nome do responsavel em vez do
                          UUID cru. Bug em prod (auditoria E2E
                          2026-05-13, #13) — o SelectValue do @base-ui
                          (e tambem do Radix com SSR) renderiza o
                          `value` cru ate o portal montar pela primeira
                          vez. Como o drawer monta em demanda (click
                          numa linha) com value ja preenchido, o trigger
                          mostrava o UUID antes do listbox abrir uma vez.

                          Solucao: passar children pro SelectValue com o
                          nome do membro selecionado (lookup em
                          `members`). Se membro nao foi carregado ainda
                          ou foi removido, cai no placeholder.
                        */}
                        <SelectValue placeholder="Selecione">
                          {members.find(
                            (m) => m.user_id === form.assigned_to,
                          )?.name ?? null}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {members.length === 0 ? (
                          <SelectItem value="_none" disabled>
                            Sem responsáveis disponíveis
                          </SelectItem>
                        ) : (
                          members.map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Website">
                    <Input
                      name="lead_website"
                      type="url"
                      value={form.website}
                      onChange={(e) => set("website", e.target.value)}
                      placeholder="https://..."
                    />
                  </Field>
                </div>
              </section>

              {/* ============ TAGS ============
                  PR-B11: secao nova (bug #15). Drawer antes nao
                  permitia gerenciar tags — usuario precisava ir pra
                  pagina legacy /leads/[id]. Agora todos podem
                  adicionar/remover sem sair do contexto. */}
              {canEdit && (
                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <TagIcon className="size-4 text-amber-600" />
                    TAGS
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {currentTags.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        Nenhuma tag adicionada.
                      </span>
                    )}
                    {currentTags.map((tag) => {
                      const isPending = tagPending === tag.id;
                      return (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                          style={{
                            borderColor: `${tag.color}40`,
                            backgroundColor: `${tag.color}20`,
                            color: tag.color,
                          }}
                        >
                          {tag.name}
                          <button
                            type="button"
                            disabled={
                              !actions.removeTagFromLead || isPending
                            }
                            onClick={() => handleRemoveTag(tag.id)}
                            aria-label={`Remover tag ${tag.name}`}
                            className="-mr-0.5 ml-0.5 inline-flex size-4 items-center justify-center rounded-full hover:bg-background/40 disabled:opacity-50"
                          >
                            {isPending ? (
                              <Loader2 className="size-2.5 animate-spin" />
                            ) : (
                              <X className="size-2.5" />
                            )}
                          </button>
                        </span>
                      );
                    })}
                    {actions.addTagToLead && availableTags.length > 0 && (
                      <Popover>
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            />
                          }
                        >
                          <Plus className="size-3" />
                          Adicionar tag
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-56 p-1.5"
                          sideOffset={6}
                        >
                          <div className="max-h-56 overflow-y-auto">
                            {availableTags.map((tag) => {
                              const isPending = tagPending === tag.id;
                              return (
                                <button
                                  key={tag.id}
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => handleAddTag(tag.id)}
                                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                                >
                                  <span
                                    className="inline-block size-2.5 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: tag.color,
                                    }}
                                    aria-hidden
                                  />
                                  <span className="flex-1 truncate">
                                    {tag.name}
                                  </span>
                                  {isPending && (
                                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </section>
              )}

              {/* ============ ENDEREÇO ============ */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <MapPin className="size-4 text-cyan-600" />
                  ENDEREÇO
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="País">
                    <Input
                      name="lead_address_country"
                      value={form.address_country}
                      onChange={(e) => set("address_country", e.target.value)}
                      placeholder="Brasil"
                    />
                  </Field>
                  <Field label="Estado">
                    <Input
                      name="lead_address_state"
                      value={form.address_state}
                      onChange={(e) => set("address_state", e.target.value)}
                      placeholder="SP"
                    />
                  </Field>
                  <Field label="Cidade">
                    <Input
                      name="lead_address_city"
                      value={form.address_city}
                      onChange={(e) => set("address_city", e.target.value)}
                      placeholder="São Paulo"
                    />
                  </Field>
                  <Field label="CEP">
                    <Input
                      name="lead_address_zip"
                      value={form.address_zip}
                      onChange={(e) => set("address_zip", e.target.value)}
                      placeholder="00000-000"
                    />
                  </Field>
                  <Field label="Endereço">
                    <Input
                      name="lead_address_street"
                      value={form.address_street}
                      onChange={(e) => set("address_street", e.target.value)}
                      placeholder="Rua, Av..."
                    />
                  </Field>
                  <Field label="Número">
                    <Input
                      name="lead_address_number"
                      value={form.address_number}
                      onChange={(e) => set("address_number", e.target.value)}
                      placeholder="123"
                    />
                  </Field>
                  <Field label="Bairro" className="sm:col-span-1">
                    <Input
                      name="lead_address_neighborhood"
                      value={form.address_neighborhood}
                      onChange={(e) =>
                        set("address_neighborhood", e.target.value)
                      }
                      placeholder="Bairro"
                    />
                  </Field>
                  <Field label="Complemento" className="sm:col-span-2">
                    <Input
                      name="lead_address_complement"
                      value={form.address_complement}
                      onChange={(e) =>
                        set("address_complement", e.target.value)
                      }
                      placeholder="Apto, bloco..."
                    />
                  </Field>
                </div>
              </section>

              {/* ============ ANOTAÇÕES ============ */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <StickyNote className="size-4 text-amber-600" />
                  ANOTAÇÕES
                </h3>
                <Textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Observações gerais sobre o lead..."
                  rows={5}
                />
              </section>
            </TabsContent>

            <TabsContent value="negocios" className="mt-0">
              <LeadNegociosTab leadId={lead.id} open={open} />
            </TabsContent>

            <TabsContent value="campos" className="mt-0">
              <CustomFieldsTab leadId={lead.id} open={open} />
            </TabsContent>

            <TabsContent value="comentarios" className="mt-0">
              {/* PR-S1: tab compartilhada via @persia/leads-ui. As 4
                  actions de CRUD vem via useLeadsActions() (CRM injeta
                  via <LeadsProvider> em lead-list.tsx). */}
              <LeadCommentsTab
                leadId={lead.id}
                open={open}
                members={members.map((m) => ({
                  user_id: m.user_id,
                  name: m.name,
                }))}
                reloadVersion={commentsBump}
              />
            </TabsContent>
          </form>
        </Tabs>

        <DialogFooter className="px-6 py-4 border-t border-border bg-card shrink-0 flex-row items-center justify-between gap-3 sm:space-x-0">
          {/* PR-U3: Excluir no canto esquerdo, gated por canDelete.
              CRM passa canDelete=isAgent; admin passa true. */}
          {canDelete && (
            <AlertDialog
              open={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
            >
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={isPending || isDeleting}
                  >
                    <Trash2 className="size-4" />
                    Excluir
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação não pode ser desfeita. O lead {lead.name ? `"${lead.name}"` : "selecionado"} e seus dados serão removidos permanentemente.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>
                    Cancelar
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {isDeleting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Fechar
            </Button>
            {canEdit && (
              <Button
                type="submit"
                form="lead-info-form"
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Salvar
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helper local — Field padroniza Label + child sem precisar repetir
// markup. Mantem o componente principal mais legivel.
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className ? `space-y-1 ${className}` : "space-y-1"}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ============================================================================
// PR-E: CustomFieldsTab — renderizacao dinamica dos custom_fields da org
// ----------------------------------------------------------------------------
// Carrega definicoes + valores quando a tab abre. Cada field e
// renderizado pelo CustomFieldInput (despacho por field_type).
// Auto-save on blur (sem botao "salvar" — o agente espera).
//
// Loading: skeleton 3 linhas. Empty: hint "Org nao configurou campos".
// Error: toast PT-BR + mantem valor anterior.
// ============================================================================

function CustomFieldsTab({
  leadId,
  open,
}: {
  leadId: string;
  open: boolean;
}) {
  // PR-U2: actions via DI
  const actions = useLeadsActions();
  const [entries, setEntries] = React.useState<LeadCustomFieldEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [savingFieldId, setSavingFieldId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !actions.getLeadCustomFields) return;
    let cancelled = false;
    setLoading(true);
    actions
      .getLeadCustomFields(leadId)
      .then((res) => {
        if (!cancelled) setEntries(res);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leadId, actions]);

  async function handleSave(fieldId: string, newValue: string) {
    if (!actions.setLeadCustomFieldValue) return;
    // Otimista: atualiza state local imediato
    setEntries((prev) =>
      prev.map((e) =>
        e.field.id === fieldId ? { ...e, value: newValue } : e,
      ),
    );
    setSavingFieldId(fieldId);
    // Sprint 3d: setLeadCustomFieldValue retorna ActionResult.
    const result = await actions.setLeadCustomFieldValue(
      leadId,
      fieldId,
      newValue,
    );
    setSavingFieldId(null);
    if (result && "error" in result && result.error) {
      toast.error(result.error, {
        id: `custom-field-${fieldId}`,
        duration: 5000,
      });
      // Reload entries pra reverter o otimista que falhou
      try {
        if (actions.getLeadCustomFields) {
          const res = await actions.getLeadCustomFields(leadId);
          setEntries(res);
        }
      } catch {
        /* swallow */
      }
      return;
    }
    // Sucesso silencioso (auto-save) — sem toast no path feliz.
  }

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1">
            <div className="h-3 w-24 bg-muted rounded animate-pulse" />
            <div className="h-9 w-full bg-muted/60 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
        <p className="font-medium">Sua organização ainda não criou campos personalizados.</p>
        <p className="mt-1 text-xs">
          Configure em Configurações → Campos personalizados pra capturar dados
          adicionais sobre cada lead (data de nascimento, segmento, prioridade,
          etc).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      {entries.map((entry) => (
        <CustomFieldInput
          key={entry.field.id}
          field={entry.field}
          value={entry.value}
          saving={savingFieldId === entry.field.id}
          onSave={(v) => handleSave(entry.field.id, v)}
        />
      ))}
    </div>
  );
}

/**
 * PR-E: dispatcher de input por field_type. Auto-save on blur (text/
 * number/url/phone/email) ou on change (select, boolean, date — esses
 * tem commit imediato pq nao tem fase intermediaria de digitacao).
 *
 * Field types suportados:
 *   - text, url, phone, email: <Input> simples (commit on blur)
 *   - number: <Input type="number"> (commit on blur, valida numero)
 *   - date: <Input type="date"> (commit on change)
 *   - boolean: <Switch> (commit on change)
 *   - select: <Select> com options do field.options (commit on change)
 *   - multi_select: NOT SUPPORTED — fallback pra text simples
 *
 * Cada caso renderiza o mesmo Field wrapper (label + spinner saving).
 */
function CustomFieldInput({
  field,
  value,
  saving,
  onSave,
}: {
  field: LeadCustomFieldDef;
  value: string;
  saving: boolean;
  onSave: (newValue: string) => void;
}) {
  const [localValue, setLocalValue] = React.useState(value);

  // Re-hidrata quando entry muda (ex: reload apos erro)
  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const labelEl = (
    <span className="flex items-center gap-1.5">
      <span>{field.name}</span>
      {field.is_required && (
        <span className="text-destructive" aria-label="obrigatório">
          *
        </span>
      )}
      {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
    </span>
  );

  // Boolean: Switch com commit imediato
  if (field.field_type === "boolean") {
    const checked = localValue === "true";
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{labelEl}</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {checked ? "Sim" : "Não"}
          </span>
          <Switch
            checked={checked}
            onCheckedChange={(next) => {
              const v = next ? "true" : "false";
              setLocalValue(v);
              onSave(v);
            }}
          />
        </div>
      </div>
    );
  }

  // Select: Select com options + commit imediato
  if (field.field_type === "select") {
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{labelEl}</Label>
        <Select
          value={localValue || undefined}
          onValueChange={(v) => {
            if (!v) return;
            setLocalValue(v);
            onSave(v);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione...">
              {localValue || "Selecione..."}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {field.options.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Sem opções configuradas
              </div>
            ) : (
              field.options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Date: input type=date com commit on change
  if (field.field_type === "date") {
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{labelEl}</Label>
        <Input
          name={`custom_${field.field_key}`}
          type="date"
          value={localValue}
          onChange={(e) => {
            const v = e.target.value;
            setLocalValue(v);
            onSave(v); // date picker commit imediato
          }}
        />
      </div>
    );
  }

  // Number: type=number com validacao + commit on blur
  if (field.field_type === "number") {
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{labelEl}</Label>
        <Input
          name={`custom_${field.field_key}`}
          type="number"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={() => {
            if (localValue === value) return; // sem mudanca, skip
            // Aceita vazio (deleta valor). Numero invalido revert.
            if (localValue !== "" && !Number.isFinite(Number(localValue))) {
              toast.error("Número inválido");
              setLocalValue(value);
              return;
            }
            onSave(localValue);
          }}
        />
      </div>
    );
  }

  // text, url, phone, email, multi_select (fallback): Input + commit on blur
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{labelEl}</Label>
      <Input
        name={`custom_${field.field_key}`}
        type={
          field.field_type === "email"
            ? "email"
            : field.field_type === "url"
              ? "url"
              : "text"
        }
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          if (localValue !== value) onSave(localValue);
        }}
        placeholder={
          field.field_type === "phone"
            ? "+55 (00) 00000-0000"
            : field.field_type === "email"
              ? "email@exemplo.com"
              : field.field_type === "url"
                ? "https://..."
                : ""
        }
      />
    </div>
  );
}

// ============================================================================
// PR-D: LeadStatsCards — 3 mini cards no header do drawer
// ----------------------------------------------------------------------------
// Renderiza count + 1 detalhe contextual por categoria. Cores:
//   - Negocios: emerald (mesmo do pill de valor no card do Kanban)
//   - Conversas: blue (consistente com chat)
//   - Atividades: violet (consistente com timeline)
//
// Loading state: mostra skeleton em cada card. Falha (stats=null):
// mostra "—" — drawer continua funcionando, so perde o sumario.

function LeadStatsCards({
  stats,
  loading,
}: {
  stats: LeadStats | null;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 px-6 py-3 bg-muted/30 border-b border-border shrink-0">
      <StatCard
        icon={<CircleDollarSign className="size-3.5 text-emerald-600" />}
        label="Negócios"
        accentClass="text-emerald-700 dark:text-emerald-400"
        loading={loading}
        primary={stats ? String(stats.deals.count) : "—"}
        detail={
          stats && stats.deals.count > 0
            ? `R$ ${formatBRL(stats.deals.total_value)}${
                stats.deals.latest_status
                  ? ` · ${humanizeDealStatus(stats.deals.latest_status)}`
                  : ""
              }`
            : stats
            ? "Nenhum negócio ainda"
            : ""
        }
      />
      <StatCard
        icon={<MessageCircle className="size-3.5 text-blue-600" />}
        label="Conversas"
        accentClass="text-blue-700 dark:text-blue-400"
        loading={loading}
        primary={stats ? String(stats.conversations.count) : "—"}
        detail={
          stats && stats.conversations.count > 0
            ? stats.conversations.last_message_at
              ? (
                  <>
                    Última msg:{" "}
                    <RelativeTime
                      iso={stats.conversations.last_message_at}
                      formatter={formatRelativeShortPtBR}
                      fallback=""
                    />
                  </>
                )
              : "Sem mensagens ainda"
            : stats
            ? "Nenhuma conversa"
            : ""
        }
      />
      <StatCard
        icon={<ActivityIcon className="size-3.5 text-violet-600" />}
        label="Atividades"
        accentClass="text-violet-700 dark:text-violet-400"
        loading={loading}
        primary={stats ? String(stats.activities.count) : "—"}
        detail={
          stats && stats.activities.count > 0
            ? truncate(stats.activities.latest_description ?? "", 28)
            : stats
            ? "Sem atividades"
            : ""
        }
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  primary,
  detail,
  accentClass,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  /** Sprint 3c: aceita ReactNode pra acomodar <RelativeTime />. */
  detail: React.ReactNode;
  accentClass: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg bg-card border border-border/60 p-2.5 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      {loading ? (
        <>
          <div className="h-5 w-8 bg-muted rounded animate-pulse" />
          <div className="h-3 w-full bg-muted/60 rounded animate-pulse" />
        </>
      ) : (
        <>
          <div className={`text-lg font-bold tabular-nums ${accentClass}`}>
            {primary}
          </div>
          {/* Sprint 3c: detail ja vem com <RelativeTime /> quando precisa
              de tempo relativo. SuppressHydrationWarning nao precisa mais. */}
          <div className="text-[11px] text-muted-foreground truncate">
            {detail}
          </div>
        </>
      )}
    </div>
  );
}

// Helpers locais — formato BR de moeda (sem dependencia nova),
// "ha X" curto, e truncate seguro pra UTF-8.
function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Sprint 3c: formatRelativeShort local removido — usa formatRelativeShortPtBR do @persia/ui.

function humanizeDealStatus(status: string): string {
  const map: Record<string, string> = {
    open: "Aberto",
    won: "Ganho",
    lost: "Perdido",
    archived: "Arquivado",
  };
  return map[status] ?? status;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ============================================================================
// PR-L2: LeadNegociosTab — lista de negocios (deals) vinculados ao lead
// ----------------------------------------------------------------------------
// Modelo conceitual confirmado pelo user:
//   1 LEAD -> N NEGOCIOS (cada negocio = produto/oportunidade especifica)
//
// UX:
//   - Header: count + valor total dos abertos + CTA "Abrir no Funil"
//   - Lista: cada negocio em card com nome + valor + etapa (badge color)
//     + status (Aberto/Ganho/Perdido) + criado em
//   - Click no card: deep-link pro Kanban (?pipeline=X) com highlight
//   - Empty state: hint pra criar primeiro negocio
//
// Loading: skeleton 3 linhas. Erro: empty + log.
// ============================================================================

function LeadNegociosTab({
  leadId,
  open,
}: {
  leadId: string;
  open: boolean;
}) {
  // PR-U2: actions via DI
  const actions = useLeadsActions();
  const [deals, setDeals] = React.useState<LeadDealItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open || !actions.getLeadDealsList) return;
    let cancelled = false;
    setLoading(true);
    actions
      .getLeadDealsList(leadId)
      .then((res) => {
        if (!cancelled) setDeals(res);
      })
      .catch((err) => {
        console.error("[LeadNegociosTab] failed:", err);
        if (!cancelled) setDeals([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leadId, actions]);

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 w-full bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
        <Briefcase className="size-6 mx-auto mb-2 text-muted-foreground/60" />
        <p className="font-medium text-foreground">
          Nenhum negócio vinculado a este lead
        </p>
        <p className="mt-1 text-xs">
          Negócios são criados automaticamente quando o lead chega no funil
          (PR-A LEADFIX). Crie negócios adicionais via Kanban → coluna →
          ícone &quot;+&quot;.
        </p>
      </div>
    );
  }

  // Agrupa por status pra resumo no header
  const openDeals = deals.filter((d) => d.status === "open");
  const totalAbertos = openDeals.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="space-y-3">
      {/* Header com resumo */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/40">
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground tabular-nums">
            {openDeals.length}
          </strong>{" "}
          abert{openDeals.length === 1 ? "o" : "os"}
          {totalAbertos > 0 && (
            <>
              {" · "}
              <strong className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                R$ {formatBRL(totalAbertos)}
              </strong>
            </>
          )}
          {deals.length > openDeals.length && (
            <>
              {" · "}
              <span>
                {deals.length - openDeals.length} fechad
                {deals.length - openDeals.length === 1 ? "o" : "os"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Lista de negocios */}
      <div className="space-y-2">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </div>
    </div>
  );
}

// Card de negocio dentro da tab. Cor da etapa como bullet visual.
// Click = navega pro Kanban no pipeline correspondente.
function DealCard({ deal }: { deal: LeadDealItem }) {
  const statusBadge = (() => {
    switch (deal.status) {
      case "open":
        return { label: "Aberto", className: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" };
      case "won":
        return { label: "Ganho", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
      case "lost":
        return { label: "Perdido", className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" };
      default:
        return { label: deal.status, className: "bg-muted text-muted-foreground" };
    }
  })();

  const href = `/crm?pipeline=${deal.pipeline_id}`;

  return (
    <a
      href={href}
      className="block rounded-lg border border-border bg-card hover:border-primary/40 hover:bg-primary/[0.02] transition-colors p-3 group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-foreground truncate flex-1">
          {deal.title}
        </h4>
        <ExternalLink className="size-3.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {/* Etapa atual com cor do stage */}
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
          style={{
            backgroundColor: `${deal.stage_color}20`,
            color: deal.stage_color,
          }}
        >
          <span
            className="inline-block size-1.5 rounded-full"
            style={{ backgroundColor: deal.stage_color }}
            aria-hidden
          />
          {deal.stage_name}
        </span>

        {/* Status do negocio */}
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${statusBadge.className}`}
        >
          {statusBadge.label}
        </span>

        {/* Valor */}
        {deal.value > 0 && (
          <span className="ml-auto font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
            R$ {formatBRL(deal.value)}
          </span>
        )}
      </div>

      {/* Sprint 3c: Criado ha X com <RelativeTime /> SSR-safe (sem #418). */}
      <p className="mt-2 text-[10px] text-muted-foreground/70 tabular-nums">
        Criado{" "}
        <RelativeTime
          iso={deal.created_at}
          formatter={formatRelativeShortPtBR}
          fallback=""
        />
      </p>
    </a>
  );
}


// ============================================================================
// PR-P: PresenceAvatars — pill mostrando quem mais esta vendo o lead.
// Renderiza ate 3 iniciais coloridas + "+N" se overflow. Tooltip com
// nome completo via title attr (nativo). Auto-oculta se nao tiver
// outros (othersCount === 0) — header limpo na grande maioria do tempo.
// ============================================================================

function PresenceAvatars({
  watchers,
  othersCount,
  currentUserId,
}: {
  watchers: { user_id: string; full_name: string }[];
  othersCount: number;
  currentUserId: string | null;
}) {
  if (othersCount === 0) return null;
  // Filtra o proprio user e pega ate 3 outros pra mostrar avatares
  const others = watchers.filter((w) => w.user_id !== currentUserId);
  const visible = others.slice(0, 3);
  const overflow = others.length - visible.length;

  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-1"
      title={`${others.map((w) => w.full_name).join(", ")} ${
        others.length === 1 ? "está vendo" : "estão vendo"
      } este lead agora`}
      aria-label={`${others.length} outro${
        others.length === 1 ? "" : "s"
      } agente${others.length === 1 ? "" : "s"} vendo este lead`}
    >
      <div className="flex -space-x-1.5">
        {visible.map((w) => (
          <div
            key={w.user_id}
            className="size-5 rounded-full border-2 border-card bg-primary/15 text-[10px] font-semibold text-primary flex items-center justify-center uppercase"
          >
            {presenceInitials(w.full_name)}
          </div>
        ))}
        {overflow > 0 ? (
          <div className="size-5 rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground flex items-center justify-center">
            +{overflow}
          </div>
        ) : null}
      </div>
      <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
        {others.length === 1 ? "está vendo" : `${others.length} vendo`}
      </span>
    </div>
  );
}

function presenceInitials(fullName: string): string {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
