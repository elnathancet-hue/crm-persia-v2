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
  GitBranch,
  ExternalLink,
  Pencil,
  Trash2,
  Send,
  MessageSquare,
  // PR-B11: icones pra secao TAGS
  Tag as TagIcon,
  Plus,
  X,
  // PR-AGENDA-DRAWER (mai/2026): tab Agenda
  Calendar,
  Clock,
  Video,
  // PR-AGENT-INTEGRATION-5 (mai/2026): tab Agente IA
  Bot,
  Pause,
  Play,
  Sparkles,
  // Tab Grupos
  Users,
  MessageSquare as GroupMessageSquare,
  Link2,
  UserMinus,
  ArrowRight,
  // Tab Produtos
  Package,
} from "lucide-react";
import type { LeadWithTags, StageOutcome, OrgProduct, LeadProduct } from "@persia/shared/crm";
import { TagBadge } from "@persia/tags-ui";
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
  LeadAppointmentItem,
  LeadCustomFieldDef,
  LeadCustomFieldEntry,
  LeadDealItem,
  LeadGroupMembership,
  LeadStats,
} from "../actions";
import { useLeadsActions } from "../context";
import { LeadCommentsTab } from "./LeadCommentsTab";
import { LeadAvatar, LeadAvatarWithRefresh } from "./LeadAvatar";
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
  /**
   * Callback chamado apos findOrCreateConversationByLead retornar com
   * sucesso. Recebe o conversationId — caller navega pra /chat?c=ID.
   * Opcional: se ausente, exibe apenas o toast informativo.
   */
  onOpenConversation?: (conversationId: string) => void;
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
  onOpenConversation,
}: Props) {
  // PR-U2: actions vem do provider via DI. Cada app injeta sua versao
  // (CRM: requireRole; admin: requireSuperadminForOrg).
  const actions = useLeadsActions();
  const [form, setForm] = React.useState<FormState>(() =>
    leadToFormState(lead),
  );
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(
    lead.avatar_url ?? null,
  );
  const [avatarRefreshing, setAvatarRefreshing] = React.useState(false);

  React.useEffect(() => {
    setAvatarUrl(lead.avatar_url ?? null);
  }, [lead.id, lead.avatar_url]);

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

  // PR-K-CENTRIC (mai/2026): subheader "Etapa atual" agora opera no
  // LEAD (lead.stage_id), nao mais no deal. Lead aparece 1x no Kanban.
  // currentDeal estado renomeado mentalmente pra "current lead stage" —
  // o shape ainda chama `id`/`stage_id` por compat com o UI legado
  // (id na verdade carrega lead.id, mesma estrategia do KanbanBoard).
  const [currentDeal, setCurrentDeal] = React.useState<{
    id: string;
    pipeline_id: string;
    stage_id: string;
  } | null>(null);
  const [drawerStages, setDrawerStages] = React.useState<DrawerStage[]>([]);
  const [stageChangePending, setStageChangePending] = React.useState(false);
  // PR-K-CENTRIC: state pra "Mudar funil" — lista pipelines + stages do
  // pipeline alvo. Lazy load no abrir do popover.
  const [pipelinesList, setPipelinesList] = React.useState<
    Array<{ id: string; name: string }>
  >([]);
  const [pipelinesLoading, setPipelinesLoading] = React.useState(false);

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

  // PR-K-CENTRIC (mai/2026): busca pipeline/stage atual do LEAD + stages
  // do pipeline. Fallback legacy removido em PR-K-CENTRIC cleanup —
  // admin agora wireia getLeadStageContext (paridade com CRM).
  React.useEffect(() => {
    if (!open) return;
    const fetchStage = actions.getLeadStageContext;
    if (!fetchStage) return;
    let cancelled = false;
    fetchStage(lead.id)
      .then((res) => {
        if (cancelled) return;
        if (res && res.lead.pipeline_id && res.lead.stage_id) {
          setCurrentDeal({
            id: res.lead.id, // PR-K-CENTRIC: id carrega lead.id
            pipeline_id: res.lead.pipeline_id,
            stage_id: res.lead.stage_id,
          });
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

  // moveLeadStage retorna ActionResult — checamos result.error e
  // revertemos UI otimista em caso de erro. Mantemos manual em vez de
  // useDialogMutation porque ha rollback otimista local especifico.
  // PR-K-CENTRIC cleanup (mai/2026): fallback legacy updateDealStage
  // removido — admin agora wireia moveLeadStage (paridade com CRM).
  async function handleChangeStage(newStageId: string) {
    if (!currentDeal || newStageId === currentDeal.stage_id) return;
    const moveLead = actions.moveLeadStage;
    if (!moveLead) {
      toast.error("Ação indisponível neste app");
      return;
    }
    const previousStageId = currentDeal.stage_id;
    setCurrentDeal({ ...currentDeal, stage_id: newStageId });
    setStageChangePending(true);
    const result = await moveLead(currentDeal.id, newStageId, 0);
    setStageChangePending(false);
    if (result && "error" in result && result.error) {
      // Revert
      setCurrentDeal((prev) =>
        prev ? { ...prev, stage_id: previousStageId } : prev,
      );
      toast.error(result.error, {
        id: `lead-stage-${currentDeal.id}`,
        duration: 5000,
      });
      return;
    }
    toast.success("Etapa atualizada", {
      id: `lead-stage-${currentDeal.id}`,
      duration: 5000,
    });
  }

  // PR-K-CENTRIC (mai/2026): lazy load lista de pipelines quando user
  // abrir o popover "Mudar funil".
  async function loadPipelinesList() {
    if (pipelinesList.length > 0 || pipelinesLoading) return;
    if (!actions.listPipelines) return;
    setPipelinesLoading(true);
    try {
      const res = await actions.listPipelines();
      setPipelinesList(res);
    } catch (err) {
      console.error("[LeadInfoDrawer] listPipelines failed:", err);
    } finally {
      setPipelinesLoading(false);
    }
  }

  // PR-K-CENTRIC: troca o lead pra outro pipeline + 1a stage.
  // Caller (UI) escolhe pipeline + stage; aqui apenas dispara a action.
  async function handleChangePipeline(
    targetPipelineId: string,
    targetStageId: string,
  ) {
    if (!currentDeal) return;
    if (
      currentDeal.pipeline_id === targetPipelineId &&
      currentDeal.stage_id === targetStageId
    ) {
      return;
    }
    if (!actions.moveLeadToPipeline) {
      toast.error("Ação indisponível neste app");
      return;
    }
    setStageChangePending(true);
    const result = await actions.moveLeadToPipeline(
      currentDeal.id,
      targetPipelineId,
      targetStageId,
    );
    setStageChangePending(false);
    if (result && "error" in result && result.error) {
      toast.error(result.error, {
        id: `lead-pipeline-${currentDeal.id}`,
        duration: 5000,
      });
      return;
    }
    // Re-busca contexto pra refletir stages do novo pipeline
    if (actions.getLeadStageContext) {
      const res = await actions.getLeadStageContext(lead.id);
      if (res && res.lead.pipeline_id && res.lead.stage_id) {
        setCurrentDeal({
          id: res.lead.id,
          pipeline_id: res.lead.pipeline_id,
          stage_id: res.lead.stage_id,
        });
        setDrawerStages(res.stages as DrawerStage[]);
      }
    }
    toast.success("Funil atualizado", {
      id: `lead-pipeline-${currentDeal.id}`,
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

  async function handleRefreshAvatar() {
    if (!actions.refreshLeadAvatar || avatarRefreshing) return;
    setAvatarRefreshing(true);
    try {
      const result = await actions.refreshLeadAvatar(lead.id);
      setAvatarUrl(result.avatar_url);
      onSaved?.({ avatar_url: result.avatar_url } as Partial<LeadWithTags>);
      toast.success(result.updated ? "Foto atualizada" : "Foto verificada", {
        id: `lead-avatar-${lead.id}`,
        duration: 4000,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao atualizar foto",
        { id: `lead-avatar-${lead.id}`, duration: 6000 },
      );
    } finally {
      setAvatarRefreshing(false);
    }
  }

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
            <div className="flex min-w-0 items-center gap-3">
              {actions.refreshLeadAvatar ? (
                <LeadAvatarWithRefresh
                  name={lead.name}
                  avatarUrl={avatarUrl}
                  size="lg"
                  hasPhone={Boolean(lead.phone)}
                  loading={avatarRefreshing}
                  onRefresh={handleRefreshAvatar}
                />
              ) : (
                <LeadAvatar name={lead.name} avatarUrl={avatarUrl} size="lg" />
              )}
              <DialogTitle>Informações do lead</DialogTitle>
            </div>
            <PresenceAvatars
              watchers={watchers}
              othersCount={othersCount}
              currentUserId={currentUser?.user_id ?? null}
            />
          </div>
          {false && currentStageObj ? (
            <DialogDescription className="sr-only">
              <span className="text-muted-foreground">Etapa atual:</span>
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      disabled={stageChangePending}
                      // PR-ANTIBUG (mai/2026): cor da etapa reflete o
                      // outcome (em_andamento=progress / falha=failure /
                      // bem_sucedido=success). Antes era text-cyan-600
                      // hardcoded — mesmo que a etapa fosse "Fechado",
                      // aparecia ciano. Agora usa o token semantico.
                      className={`inline-flex items-center gap-1 font-medium hover:underline transition-colors ${
                        OUTCOME_COLOR[
                          currentStageObj?.outcome ?? "em_andamento"
                        ] ?? "text-foreground"
                      }`}
                    />
                  }
                >
                  <span>{currentStageObj?.name}</span>
                  <ChevronDown className="size-3" />
                </PopoverTrigger>
                <PopoverContent className="w-56 p-1 max-h-72 overflow-y-auto" align="start">
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
              {/* PR-K-CENTRIC (mai/2026): botao "Mudar funil" — popover
                  lista pipelines + 1a stage do pipeline selecionado.
                  Lazy load da lista de pipelines no abrir. */}
              {actions.moveLeadToPipeline && actions.listPipelines && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <Popover onOpenChange={(o) => o && loadPipelinesList()}>
                    <PopoverTrigger
                      render={
                        <button
                          type="button"
                          disabled={stageChangePending}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline transition-colors"
                        />
                      }
                    >
                      Mudar funil
                      <ChevronDown className="size-3" />
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-1 max-h-80 overflow-y-auto" align="start">
                      {pipelinesLoading ? (
                        <p className="px-2 py-2 text-xs text-muted-foreground">
                          Carregando funis...
                        </p>
                      ) : pipelinesList.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-muted-foreground">
                          Nenhum funil cadastrado.
                        </p>
                      ) : (
                        pipelinesList.map((p) => (
                          <PipelinePicker
                            key={p.id}
                            pipeline={p}
                            currentPipelineId={currentDeal?.pipeline_id ?? null}
                            disabled={stageChangePending}
                            onSelect={(stageId) =>
                              handleChangePipeline(p.id, stageId)
                            }
                            listStages={actions.listStagesForPipeline}
                          />
                        ))
                      )}
                    </PopoverContent>
                  </Popover>
                </>
              )}
            </DialogDescription>
          ) : currentStageName ? (
            // Fallback display estatico (caller pode ainda passar
            // currentStageName mesmo sem deal aberto — ex: contexto
            // sem permissao de edicao).
            <DialogDescription className="sr-only">
              <span className="text-muted-foreground">Etapa atual:</span>
              <span className="font-medium text-foreground">
                {currentStageName}
              </span>
            </DialogDescription>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Posição no CRM</span>
            {actions.moveLeadToPipeline && actions.listPipelines && (
              <Popover onOpenChange={(o) => o && loadPipelinesList()}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant={currentStageObj ? "secondary" : "default"}
                      size="sm"
                      disabled={stageChangePending}
                      className="h-8 rounded-md gap-1.5 px-2.5"
                    />
                  }
                >
                  <GitBranch className="size-3.5" />
                  {currentStageObj ? "Mudar funil/etapa" : "Colocar em funil"}
                  <ChevronDown className="size-3.5" />
                </PopoverTrigger>
                <PopoverContent className="w-72 p-1 max-h-80 overflow-y-auto" align="start">
                  {pipelinesLoading ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground">
                      Carregando funis...
                    </p>
                  ) : pipelinesList.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground">
                      Nenhum funil cadastrado.
                    </p>
                  ) : (
                    pipelinesList.map((p) => (
                      <PipelinePicker
                        key={p.id}
                        pipeline={p}
                        currentPipelineId={currentDeal?.pipeline_id ?? null}
                        disabled={stageChangePending}
                        onSelect={(stageId) =>
                          handleChangePipeline(p.id, stageId)
                        }
                        listStages={actions.listStagesForPipeline}
                      />
                    ))
                  )}
                </PopoverContent>
              </Popover>
            )}
            {currentStageObj ? (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={stageChangePending}
                      className="h-8 rounded-md gap-1.5 px-2.5"
                    />
                  }
                >
                  <span className="text-muted-foreground">Etapa:</span>
                  <span
                    className={`font-semibold ${OUTCOME_COLOR[currentStageObj.outcome] ?? "text-foreground"}`}
                  >
                    {currentStageObj.name}
                  </span>
                  <ChevronDown className="size-3.5" />
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
            ) : currentStageName ? (
              <span className="inline-flex h-8 items-center rounded-md border border-border px-2.5 font-medium text-foreground">
                Etapa: {currentStageName}
              </span>
            ) : (
              <span className="inline-flex h-8 items-center rounded-md border border-dashed border-border px-2.5 font-medium text-muted-foreground">
                Sem funil definido
              </span>
            )}
          </div>
        </DialogHeader>

        {/* PR-D: header rico — 3 cards de stats (Negocios / Conversas /
            Atividades). Mostram count + info "de uma olhada" pro agente
            entender historico do lead sem trocar de tab/pagina. */}
        <LeadStatsCards stats={stats} loading={statsLoading} />

        <Tabs defaultValue="dados" className="flex-1 flex flex-col min-h-0">
          {/* 7 tabs. Mobile: 2 cols (4 linhas); Desktop: 7 cols (1 linha). */}
          <TabsList className="mx-5 mt-3 grid grid-cols-2 sm:grid-cols-7">
            <TabsTrigger value="dados">
              <Contact className="size-4" />
              Dados
            </TabsTrigger>
            {/* Produtos/Serviços vinculados ao lead (migration 106) */}
            <TabsTrigger value="produtos">
              <Package className="size-4" />
              Produtos
            </TabsTrigger>
            {/* PR-AGENDA-DRAWER (mai/2026): tab Agenda */}
            <TabsTrigger value="agenda">
              <Calendar className="size-4" />
              Agenda
            </TabsTrigger>
            {/* Tab Grupos — grupos WhatsApp em que o lead participou */}
            <TabsTrigger value="grupos">
              <Users className="size-4" />
              Grupos
            </TabsTrigger>
            {/* PR-AGENT-INTEGRATION-5 (mai/2026): tab Agente IA */}
            <TabsTrigger value="agente">
              <Bot className="size-4" />
              Agente IA
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
            className="flex-1 overflow-y-auto px-6 py-4 pb-20 md:pb-4 space-y-6"
          >
            <TabsContent value="dados" className="space-y-6 mt-0">
              {/* ============ CONTATO ============ */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Contact className="size-4 text-muted-foreground" />
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
                    <TagIcon className="size-4 text-muted-foreground" />
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
                      // PR-ANTIBUG (mai/2026): substitui pill inline custom
                      // (`${tag.color}40` reinventado) pelo <TagBadge>
                      // compartilhado. Cada tag ja distingue visualmente
                      // pela cor real do banco — antes tudo parecia azul
                      // porque o calculo de alpha era manual.
                      return (
                        <TagBadge
                          key={tag.id}
                          tag={tag}
                          variant="soft"
                          size="sm"
                          className={isPending ? "opacity-50 pointer-events-none" : undefined}
                          onRemove={
                            actions.removeTagFromLead
                              ? () => handleRemoveTag(tag.id)
                              : undefined
                          }
                        />
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
                  <MapPin className="size-4 text-muted-foreground" />
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
                  <StickyNote className="size-4 text-muted-foreground" />
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

            <TabsContent value="produtos" className="mt-0">
              <LeadProdutosTab leadId={lead.id} open={open} />
            </TabsContent>

            <TabsContent value="agenda" className="mt-0">
              <LeadAgendaTab leadId={lead.id} open={open} />
            </TabsContent>

            <TabsContent value="grupos" className="mt-0">
              <LeadGruposTab leadId={lead.id} lead={lead} open={open} onOpenConversation={onOpenConversation} />
            </TabsContent>

            {/* PR-AGENT-INTEGRATION-5: tab Agente IA — status atual,
                pause/resume manual, trilha de runs + activities. */}
            <TabsContent value="agente" className="mt-0">
              <LeadAgentTab leadId={lead.id} open={open} />
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

        <DialogFooter className="px-card-lg py-4 border-t border-border bg-card shrink-0 flex-row items-center justify-between gap-3 sm:space-x-0">
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
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isPending ? "Salvando…" : "Salvar"}
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
// LeadGruposTab — grupos WhatsApp em que o lead participou
// ----------------------------------------------------------------------------
// Busca via getLeadGroups (DI opcional). Se ausente, tab mostra empty state.
// Exibe: grupo, campanha, data de entrada, origem, contagem de mensagens,
// última mensagem no grupo. Ações rápidas: chamar no privado, remover do grupo.
// ============================================================================

const SOURCE_LABEL: Record<string, string> = {
  smart_link: "Smart Link",
  manual: "Manual",
  webhook: "Webhook",
};

function utmLabel(utm: string | null, source: string): string {
  if (!utm) return SOURCE_LABEL[source] ?? source;
  const lower = utm.toLowerCase();
  if (lower.includes("facebook") || lower.includes("fb")) return "Meta Ads";
  if (lower.includes("instagram") || lower.includes("ig")) return "Instagram";
  if (lower.includes("google")) return "Google Ads";
  if (lower.includes("youtube")) return "YouTube";
  if (lower.includes("tiktok")) return "TikTok";
  // Capitalize first letter
  return utm.charAt(0).toUpperCase() + utm.slice(1);
}

function LeadGruposTab({
  leadId,
  lead,
  open,
  onOpenConversation,
}: {
  leadId: string;
  lead: LeadWithTags;
  open: boolean;
  onOpenConversation?: (conversationId: string) => void;
}) {
  const { getLeadGroups, removeLeadFromGroup, findOrCreateConversationByLead } = useLeadsActions();
  const [groups, setGroups] = React.useState<LeadGroupMembership[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [openingChat, setOpeningChat] = React.useState(false);

  React.useEffect(() => {
    if (!open || loaded || !getLeadGroups) return;
    setLoading(true);
    getLeadGroups(leadId)
      .then(setGroups)
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [open, loaded, leadId, getLeadGroups]);

  if (!getLeadGroups) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Recurso não disponível nesta versão.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!loading && groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center">
          <Users className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">Nenhum grupo vinculado</p>
        <p className="text-xs text-muted-foreground max-w-[240px]">
          Este lead ainda não entrou em nenhum grupo monitorado pelo CRM.
        </p>
      </div>
    );
  }

  async function handleOpenChat() {
    if (!findOrCreateConversationByLead) return;
    setOpeningChat(true);
    try {
      const { conversationId } = await findOrCreateConversationByLead(leadId);
      if (onOpenConversation) {
        onOpenConversation(conversationId);
      } else {
        toast.info("Conversa aberta no privado");
      }
    } catch {
      toast.error("Erro ao abrir conversa");
    } finally {
      setOpeningChat(false);
    }
  }

  async function handleRemove(membershipId: string, groupName: string) {
    if (!removeLeadFromGroup) return;
    if (!confirm(`Remover ${lead.name ?? "este lead"} do grupo "${groupName}"? O participante será removido do WhatsApp também.`)) return;
    setRemoving(membershipId);
    try {
      await removeLeadFromGroup(membershipId);
      setGroups((prev) => prev.filter((g) => g.id !== membershipId));
      toast.success("Lead removido do grupo");
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao remover do grupo");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-3 py-2">
      {/* Quick actions bar */}
      <div className="flex flex-wrap gap-2 px-1">
        {findOrCreateConversationByLead && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenChat}
            disabled={openingChat}
          >
            {openingChat ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GroupMessageSquare className="size-4" />
            )}
            Chamar no privado
          </Button>
        )}
      </div>

      {/* Group cards */}
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.id} className="rounded-xl border bg-card p-4 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="shrink-0 flex items-center justify-center">
                  {g.group_image_url ? (
                    <LeadAvatar name={g.group_name} avatarUrl={g.group_image_url} size="sm" />
                  ) : (
                    <div className="size-8 rounded-full bg-progress-soft flex items-center justify-center shrink-0">
                      <Users className="size-4 text-progress" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{g.group_name}</p>
                  {g.campaign_name && (
                    <p className="text-xs text-muted-foreground truncate">{g.campaign_name}</p>
                  )}
                </div>
              </div>
              {removeLeadFromGroup && !g.left_at && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Remover do grupo"
                  onClick={() => handleRemove(g.id, g.group_name)}
                  disabled={removing === g.id}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                >
                  {removing === g.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <UserMinus className="size-4" />
                  )}
                </Button>
              )}
            </div>

            {/* Detail rows */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Entrada no grupo</dt>
                <dd className="font-medium">
                  {new Date(g.joined_at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Origem</dt>
                <dd className="font-medium">{utmLabel(g.utm_source, g.source)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status no grupo</dt>
                <dd>
                  {g.left_at ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-muted-foreground inline-block" />
                      {"Saiu em " + new Date(g.left_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                      <span className="size-1.5 rounded-full bg-success inline-block" />
                      Participante
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Mensagens no grupo</dt>
                <dd className="font-medium">
                  {g.message_count > 0 ? (
                    <span className="flex items-center gap-1">
                      <GroupMessageSquare className="size-3.5 text-muted-foreground" />
                      {g.message_count}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              {g.last_message && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Última mensagem no grupo</dt>
                  <dd className="font-medium text-sm truncate max-w-full" title={g.last_message}>
                    &ldquo;{g.last_message}&rdquo;
                  </dd>
                </div>
              )}
            </dl>

            {/* Footer link to group page */}
            <div className="flex items-center gap-1.5 pt-1 border-t">
              <Link2 className="size-3.5 text-muted-foreground" />
              <button
                type="button"
                className="text-xs text-primary hover:underline flex items-center gap-0.5"
                onClick={() => {
                  window.location.href = `/groups?id=${g.group_id}`;
                }}
              >
                Ver grupo completo
                <ArrowRight className="size-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
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
        icon={<CircleDollarSign className="size-3.5 text-success" />}
        label="Negócios"
        accentClass="text-success"
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
        icon={<MessageCircle className="size-3.5 text-primary" />}
        label="Conversas"
        accentClass="text-primary"
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
        icon={<ActivityIcon className="size-3.5 text-progress" />}
        label="Atividades"
        accentClass="text-progress"
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

// ============================================================================
// CreateDealForLeadDialog (PR-K-CENTRIC mai/2026)
// ----------------------------------------------------------------------------
// Dialog inline pra criar negócio dentro do drawer do lead. Form leve
// (title + value) — pipeline/stage herdados do lead atual no caller.
// ============================================================================

function CreateDealForLeadDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSubmit: (title: string, value: number) => void | Promise<void>;
  pending: boolean;
}) {
  const [title, setTitle] = React.useState("");
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setTitle("");
      setValue("");
    }
  }, [open]);

  const trimmedTitle = title.trim();
  const numericValue = Number(value.replace(",", ".")) || 0;
  const canSubmit = trimmedTitle.length > 0 && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar negócio</DialogTitle>
          <DialogDescription>
            Esse lead está fechando uma venda? Cadastre aqui pra acompanhar o
            valor e o histórico.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void onSubmit(trimmedTitle, numericValue);
          }}
          className="space-y-4 py-2"
        >
          <div className="space-y-2">
            <Label htmlFor="new-deal-title">Nome do negócio *</Label>
            <Input
              id="new-deal-title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Plano Anual · Renovação · Pacote Premium"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-deal-value">Valor previsto (R$)</Label>
            <Input
              id="new-deal-value"
              name="value"
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0,00"
            />
            <p className="text-[11px] text-muted-foreground">
              Opcional. Quanto você espera receber se fechar essa venda.
            </p>
          </div>
          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="default" disabled={!canSubmit}>
              {pending ? "Adicionando..." : "Adicionar negócio"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// PipelinePicker (PR-K-CENTRIC mai/2026)
// ----------------------------------------------------------------------------
// Linha do popover "Mudar funil". Mostra nome do pipeline + lazy-load
// das stages do pipeline ao expandir. Click numa stage chama onSelect
// com o stageId. Indica o pipeline atual visualmente.
// ============================================================================

function PipelinePicker({
  pipeline,
  currentPipelineId,
  disabled,
  onSelect,
  listStages,
}: {
  pipeline: { id: string; name: string };
  currentPipelineId: string | null;
  disabled: boolean;
  onSelect: (stageId: string) => void;
  listStages?: (pipelineId: string) => Promise<
    Array<{
      id: string;
      name: string;
      color: string;
      outcome: "em_andamento" | "falha" | "bem_sucedido";
      sort_order: number;
    }>
  >;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [stages, setStages] = React.useState<
    Array<{ id: string; name: string; color: string; sort_order: number }>
  >([]);
  const [loading, setLoading] = React.useState(false);
  const isCurrent = pipeline.id === currentPipelineId;

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (stages.length === 0 && listStages) {
      setLoading(true);
      try {
        const res = await listStages(pipeline.id);
        setStages(res.sort((a, b) => a.sort_order - b.sort_order));
      } catch (err) {
        console.error("[PipelinePicker] listStages failed:", err);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="rounded">
      <Button
        type="button"
        onClick={toggle}
        disabled={disabled}
        variant="ghost"
        size="sm"
        className={`w-full justify-between rounded px-2 py-1.5 text-xs font-normal ${
          isCurrent ? "bg-primary/10 font-medium text-primary" : ""
        }`}
      >
        <span className="truncate">{pipeline.name}</span>
        {isCurrent ? (
          <span className="text-[10px] text-primary">atual</span>
        ) : (
          <ChevronDown
            className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </Button>
      {expanded && !isCurrent && (
        <div className="pl-2 py-1 max-h-60 overflow-y-auto">
          {loading ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              Carregando etapas...
            </p>
          ) : stages.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              Esse funil ainda não tem etapas cadastradas.
            </p>
          ) : (
            stages.map((s) => (
              <Button
                key={s.id}
                type="button"
                onClick={() => onSelect(s.id)}
                disabled={disabled}
                variant="ghost"
                size="sm"
                className="w-full justify-start rounded px-2 py-1 text-[11px] font-normal"
              >
                <span
                  className="size-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="truncate">{s.name}</span>
              </Button>
            ))
          )}
        </div>
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
  // PR-K-CENTRIC (mai/2026): create dialog state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createPending, setCreatePending] = React.useState(false);

  const reload = React.useCallback(async () => {
    if (!actions.getLeadDealsList) return;
    setLoading(true);
    try {
      const res = await actions.getLeadDealsList(leadId);
      setDeals(res);
    } catch (err) {
      console.error("[LeadNegociosTab] failed:", err);
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }, [leadId, actions]);

  React.useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 w-full bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  // PR-K-CENTRIC (mai/2026): deals viram opt-in. User cria negocio
  // explicitamente clicando "+ Novo negocio" no header.
  async function handleCreate(title: string, value: number) {
    if (!actions.createDealForLead || !actions.getLeadStageContext) {
      toast.error("Ação indisponível neste app");
      return;
    }
    setCreatePending(true);
    try {
      const ctx = await actions.getLeadStageContext(leadId);
      if (!ctx || !ctx.lead.pipeline_id || !ctx.lead.stage_id) {
        toast.error("Coloque o lead em um funil antes de adicionar negócio");
        return;
      }
      await actions.createDealForLead({
        leadId,
        pipelineId: ctx.lead.pipeline_id,
        stageId: ctx.lead.stage_id,
        title,
        value,
      });
      setCreateOpen(false);
      await reload();
      toast.success("Negócio adicionado", { duration: 4000 });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Não foi possível adicionar o negócio",
        { duration: 5000 },
      );
    } finally {
      setCreatePending(false);
    }
  }

  const canCreate = Boolean(actions.createDealForLead && actions.getLeadStageContext);

  if (deals.length === 0) {
    return (
      <>
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          <Briefcase className="size-6 mx-auto mb-2 text-muted-foreground/60" />
          <p className="font-medium text-foreground">
            Nenhum negócio cadastrado ainda
          </p>
          <p className="mt-1 text-xs">
            Quando esse lead estiver fechando uma venda, cadastre o negócio
            aqui pra registrar o valor e acompanhar o resultado.
          </p>
          {canCreate && (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="mt-4"
              onClick={() => setCreateOpen(true)}
            >
              + Adicionar negócio
            </Button>
          )}
        </div>
        <CreateDealForLeadDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSubmit={handleCreate}
          pending={createPending}
        />
      </>
    );
  }

  // Agrupa por status pra resumo no header
  const openDeals = deals.filter((d) => d.status === "open");
  const totalAbertos = openDeals.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="space-y-3">
      {/* Header com resumo + acao de criar */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/40">
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground tabular-nums">
            {openDeals.length}
          </strong>{" "}
          abert{openDeals.length === 1 ? "o" : "os"}
          {totalAbertos > 0 && (
            <>
              {" · "}
              <strong className="text-success tabular-nums">
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
        {canCreate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            + Adicionar negócio
          </Button>
        )}
      </div>

      {/* Lista de negocios */}
      <div className="space-y-2">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </div>

      <CreateDealForLeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        pending={createPending}
      />
    </div>
  );
}

// Card de negocio dentro da tab. Cor da etapa como bullet visual.
// Click = navega pro Kanban no pipeline correspondente.
function DealCard({ deal }: { deal: LeadDealItem }) {
  // Regra global DS (mai/2026): badges de status com contraste forte.
  // Antes "won"/"lost" usavam *-soft (muito claros) e "open" usava
  // primary/10 — user reclamou de baixo contraste. Solido + foreground.
  const statusBadge = (() => {
    switch (deal.status) {
      case "open":
        return { label: "Aberto", className: "bg-primary text-primary-foreground" };
      case "won":
        return { label: "Ganho", className: "bg-success text-success-foreground" };
      case "lost":
        return { label: "Perdido", className: "bg-destructive text-destructive-foreground" };
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
          <span className="ml-auto font-semibold text-success tabular-nums">
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
// LeadProdutosTab — produtos/serviços vinculados ao lead (migration 106)
// ============================================================================

function LeadProdutosTab({ leadId, open }: { leadId: string; open: boolean }) {
  const actions = useLeadsActions();
  const [items, setItems] = React.useState<LeadProduct[]>([]);
  const [catalog, setCatalog] = React.useState<OrgProduct[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LeadProduct | null>(null);

  const reload = React.useCallback(async () => {
    if (!actions.getLeadProducts) return;
    setLoading(true);
    try {
      const [prods, cat] = await Promise.all([
        actions.getLeadProducts(leadId),
        actions.listOrgProducts?.({ activeOnly: true }) ?? [],
      ]);
      setItems(prods);
      setCatalog(cat);
    } catch (err) {
      console.error("[LeadProdutosTab] failed:", err);
    } finally {
      setLoading(false);
    }
  }, [leadId, actions]);

  React.useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (item: LeadProduct) => { setEditing(item); setDialogOpen(true); };

  const handleRemove = async (itemId: string) => {
    if (!actions.removeLeadProduct) return;
    try {
      await actions.removeLeadProduct(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch {
      toast.error("Não foi possível remover o produto");
    }
  };

  const handleSave = async (
    productId: string,
    quantity: number,
    unitPrice: number,
    discount: number,
  ) => {
    try {
      if (editing) {
        await actions.updateLeadProduct?.(editing.id, { product_id: productId, quantity, unit_price: unitPrice, discount });
      } else {
        await actions.addLeadProduct?.(leadId, { product_id: productId, quantity, unit_price: unitPrice, discount });
      }
      setDialogOpen(false);
      await reload();
      toast.success(editing ? "Produto atualizado" : "Produto adicionado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar");
    }
  };

  const total = items.reduce(
    (sum, i) => sum + (i.unit_price - i.discount) * i.quantity,
    0,
  );

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 w-full bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/40">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Package className="size-4 text-primary" />
            Produtos vinculados
          </span>
          {actions.addLeadProduct && (
            <Button type="button" size="sm" onClick={openAdd}>
              + Adicionar
            </Button>
          )}
        </div>

        {/* Lista */}
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            <Package className="size-6 mx-auto mb-2 text-muted-foreground/60" />
            <p className="font-medium text-foreground">Nenhum produto cadastrado</p>
            <p className="mt-1 text-xs">Adicione produtos ou serviços de interesse deste lead.</p>
            {actions.addLeadProduct && (
              <Button type="button" size="sm" className="mt-4" onClick={openAdd}>
                + Adicionar
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              {items.map((item) => {
                const itemTotal = (item.unit_price - item.discount) * item.quantity;
                const productName = item.org_products?.name ?? "Produto";
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                  >
                    <Package className="size-4 shrink-0 text-primary/60" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{productName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.quantity}x R$ {formatBRL(item.unit_price)}
                        {item.discount > 0 && ` − R$ ${formatBRL(item.discount)} desc.`}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">
                      R$ {formatBRL(itemTotal)}
                    </span>
                    {actions.updateLeadProduct && (
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Editar"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    {actions.removeLeadProduct && (
                      <button
                        type="button"
                        onClick={() => handleRemove(item.id)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Remover"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Total */}
            <div className="flex items-center justify-between border-t border-border/40 pt-2">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-sm font-bold text-foreground tabular-nums">
                R$ {formatBRL(total)}
              </span>
            </div>
          </>
        )}
      </div>

      <LeadProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        catalog={catalog}
        editing={editing}
        onSave={handleSave}
      />
    </>
  );
}

function LeadProductDialog({
  open,
  onOpenChange,
  catalog,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  catalog: OrgProduct[];
  editing: LeadProduct | null;
  onSave: (productId: string, quantity: number, unitPrice: number, discount: number) => Promise<void>;
}) {
  const [productId, setProductId] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [unitPrice, setUnitPrice] = React.useState("0");
  const [discount, setDiscount] = React.useState("0");
  const [pending, setPending] = React.useState(false);

  // Preenche form quando abre em modo edição
  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setProductId(editing.product_id);
      setQuantity(String(editing.quantity));
      setUnitPrice(String(editing.unit_price));
      setDiscount(String(editing.discount));
    } else {
      setProductId(catalog[0]?.id ?? "");
      setQuantity("1");
      setUnitPrice(catalog[0] ? String(catalog[0].price) : "0");
      setDiscount("0");
    }
  }, [open, editing, catalog]);

  // Quando muda produto no select, preenche unit_price do catálogo
  const handleProductChange = (id: string | null) => {
    if (!id) return;
    setProductId(id);
    const prod = catalog.find((p) => p.id === id);
    if (prod) setUnitPrice(String(prod.price));
  };

  const handleSubmit = async () => {
    if (!productId) return;
    const qty = parseFloat(quantity.replace(",", "."));
    const price = parseFloat(unitPrice.replace(",", "."));
    const disc = parseFloat(discount.replace(",", "."));
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price < 0 || isNaN(disc) || disc < 0) {
      toast.error("Valores inválidos");
      return;
    }
    setPending(true);
    try {
      await onSave(productId, qty, price, disc);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl w-[92vw] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar produto" : "Adicionar produto"}</DialogTitle>
          <DialogDescription className="sr-only">
            Selecione um produto e informe quantidade, valor e desconto.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Produto *</Label>
            <Select value={productId} onValueChange={handleProductChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um produto" />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — R$ {formatBRL(p.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Qtd</Label>
              <Input
                type="number"
                min="0.001"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor unit.</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Desconto</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={pending || !productId}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

// ============================================================================
// PR-AGENDA-DRAWER (mai/2026): LeadAgendaTab — appointments do lead
// ----------------------------------------------------------------------------
// Fecha o loop visual CRM<->Agenda. Antes, agente precisava sair do
// drawer e ir pra /agenda pra ver historico de agendamentos do lead.
// Agora veem inline com cards proximos vs passados separados.
//
// UX:
//   - Header: count + CTA "Ver todos na agenda" (deep-link futuro)
//   - Lista: cards agrupados Próximos (futuros + awaiting_confirmation)
//     vs Histórico (passados + cancelled/completed/no_show/rescheduled)
//   - Cada card: status badge + título + data/hora + canal (location/meeting)
//   - Empty state: hint que pode criar via "Agenda > Novo"
//
// NAO inclui criar/editar appointment aqui — esses fluxos vivem em
// /agenda. Drawer e read-only-ish (futuro: botao "Reagendar" inline).
// ============================================================================

function LeadAgendaTab({
  leadId,
  open,
}: {
  leadId: string;
  open: boolean;
}) {
  const actions = useLeadsActions();
  const [items, setItems] = React.useState<LeadAppointmentItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (!actions.getLeadAppointments) return;
    let cancelled = false;
    setLoading(true);
    actions
      .getLeadAppointments(leadId)
      .then((res) => {
        if (!cancelled) setItems(res);
      })
      .catch((err) => {
        console.error("[LeadAgendaTab] failed:", err);
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leadId, actions]);

  if (!actions.getLeadAppointments) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
        Agenda indisponível neste app.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 w-full bg-muted rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
        <Calendar className="size-6 mx-auto mb-2 text-muted-foreground/60" />
        <p className="font-medium text-foreground">
          Nenhum agendamento ainda
        </p>
        <p className="mt-1 text-xs">
          Crie um agendamento via menu Agenda &gt; Novo. Aparece aqui
          automaticamente quando vincular ao lead.
        </p>
      </div>
    );
  }

  // Agrupa próximos (futuros + awaiting_confirmation) vs histórico.
  // Server ja retorna desc por start_at; reordenamos próximos pra asc
  // (mais proximo primeiro) e historico fica desc (mais recente primeiro).
  const now = Date.now();
  const upcoming = items
    .filter(
      (a) =>
        (a.status === "confirmed" || a.status === "awaiting_confirmation") &&
        new Date(a.start_at).getTime() >= now,
    )
    .sort(
      (a, b) =>
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );
  const past = items.filter((a) => !upcoming.includes(a));

  return (
    <div className="space-y-4">
      {/* Header com contador */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/40">
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground tabular-nums">
            {upcoming.length}
          </strong>{" "}
          próximo{upcoming.length === 1 ? "" : "s"}
          {past.length > 0 && (
            <>
              {" · "}
              <span className="tabular-nums">
                {past.length} no histórico
              </span>
            </>
          )}
        </div>
      </div>

      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Próximos
          </h4>
          <div className="space-y-2">
            {upcoming.map((appt) => (
              <AppointmentCardRow key={appt.id} appointment={appt} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Histórico
          </h4>
          <div className="space-y-2">
            {past.map((appt) => (
              <AppointmentCardRow key={appt.id} appointment={appt} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ============================================================================
// AppointmentCardRow — card compacto de 1 appointment
// ============================================================================

const STATUS_LABEL: Record<string, string> = {
  awaiting_confirmation: "Aguardando",
  confirmed: "Confirmado",
  completed: "Realizado",
  cancelled: "Cancelado",
  no_show: "Faltou",
  rescheduled: "Reagendado",
};

const STATUS_TONE: Record<string, string> = {
  awaiting_confirmation: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  confirmed: "bg-primary/10 text-primary",
  completed: "bg-success/10 text-success",
  cancelled: "bg-muted text-muted-foreground line-through",
  no_show: "bg-destructive/10 text-destructive",
  rescheduled: "bg-muted text-muted-foreground",
};

function AppointmentCardRow({
  appointment,
}: {
  appointment: LeadAppointmentItem;
}) {
  const startDate = new Date(appointment.start_at);
  const endDate = new Date(appointment.end_at);

  // Format pt-BR — Intl direto pra evitar import shared agenda (drawer
  // nao pode depender de @persia/agenda-ui senao vira ciclo).
  const dateLabel = startDate.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: appointment.timezone,
  });
  const timeLabel = `${startDate.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: appointment.timezone,
  })} – ${endDate.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: appointment.timezone,
  })}`;

  const statusLabel =
    STATUS_LABEL[appointment.status] ?? appointment.status;
  const statusTone =
    STATUS_TONE[appointment.status] ??
    "bg-muted text-muted-foreground";

  const isOnline = Boolean(appointment.meeting_url) || appointment.channel === "online";

  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone}`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">
            {appointment.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3" />
              <span className="capitalize">{dateLabel}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {timeLabel}
            </span>
            {isOnline && (
              <span className="inline-flex items-center gap-1 text-primary">
                <Video className="size-3" />
                Online
              </span>
            )}
            {appointment.location && !isOnline && (
              <span className="inline-flex items-center gap-1 max-w-[60%]">
                <MapPin className="size-3" />
                <span className="truncate">{appointment.location}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PR-AGENT-INTEGRATION-5 (mai/2026): tab "Agente IA" do LeadDrawer.
// Status atual da conversa com IA + pause/resume manual + trilha
// de runs + lead_activities. Tudo via DI (useLeadsActions). Quando
// app caller nao implementa getLeadAgentStatus, tab some.
// ============================================================

function LeadAgentTab({ leadId, open }: { leadId: string; open: boolean }) {
  const actions = useLeadsActions();
  const [status, setStatus] = React.useState<
    import("@persia/shared/ai-agent").LeadAgentStatus | null
  >(null);
  const [runs, setRuns] = React.useState<
    import("@persia/shared/ai-agent").AgentRunSummary[]
  >([]);
  const [activities, setActivities] = React.useState<
    import("@persia/shared/ai-agent").LeadAgentActivitySummary[]
  >([]);
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const reload = React.useCallback(async () => {
    if (!actions.getLeadAgentStatus) return;
    setLoading(true);
    try {
      const [s, r, a] = await Promise.all([
        actions.getLeadAgentStatus(leadId),
        actions.listLeadAgentRuns?.(leadId, 5) ?? Promise.resolve([]),
        actions.listLeadAgentActivities?.(leadId, 10) ?? Promise.resolve([]),
      ]);
      setStatus(s);
      setRuns(r);
      setActivities(a);
    } catch (err) {
      console.error("[LeadAgentTab] failed:", err);
    } finally {
      setLoading(false);
    }
  }, [actions, leadId]);

  React.useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  if (!actions.getLeadAgentStatus) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
        Agente IA indisponível neste app.
      </div>
    );
  }

  if (loading && !status) {
    return (
      <div className="space-y-2 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 w-full bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center">
        <Bot className="size-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium">Nenhum agente IA respondeu este lead</p>
        <p className="text-xs text-muted-foreground mt-1">
          Quando a IA enviar a primeira mensagem, aparece aqui.
        </p>
      </div>
    );
  }

  const isPaused = status.paused_at !== null;

  const handlePause = async () => {
    if (!actions.pauseLeadAgent) return;
    setPending(true);
    try {
      await actions.pauseLeadAgent(status.agent_conversation_id);
      toast.success("Agente pausado");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao pausar");
    } finally {
      setPending(false);
    }
  };

  const handleResume = async () => {
    if (!actions.resumeLeadAgent) return;
    setPending(true);
    try {
      await actions.resumeLeadAgent(status.agent_conversation_id);
      toast.success("Agente reativado");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao reativar");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header: status atual + botão pause/resume */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${
                isPaused
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary/15 text-primary"
              }`}
            >
              <Sparkles className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{status.config_name}</p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    isPaused
                      ? "bg-warning-soft text-warning-soft-foreground"
                      : "bg-success-soft text-success-soft-foreground"
                  }`}
                >
                  {isPaused ? "Pausado" : "Ativo"}
                </span>
                {status.last_interaction_at ? (
                  <span className="text-[11px] text-muted-foreground">
                    Última msg{" "}
                    <RelativeTime iso={status.last_interaction_at} />
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {isPaused ? (
            <Button
              size="sm"
              onClick={handleResume}
              disabled={pending || !actions.resumeLeadAgent}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Reativar IA
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePause}
              disabled={pending || !actions.pauseLeadAgent}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Pause className="size-3.5" />
              )}
              Pausar IA
            </Button>
          )}
        </div>
      </div>

      {/* Trilha de ações da IA neste lead */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
          Ações da IA neste lead
        </h3>
        {activities.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1 py-2">
            Nenhuma ação registrada ainda.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {activities.map((a) => (
              <li
                key={a.id}
                className="rounded-lg border bg-muted/30 px-3 py-2 text-xs"
              >
                <p className="font-medium">{a.description}</p>
                <p className="text-muted-foreground mt-0.5">
                  <RelativeTime iso={a.created_at} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Últimas execuções */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
          Últimas execuções
        </h3>
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1 py-2">
            Nenhuma execução registrada.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {runs.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border bg-muted/30 px-3 py-2 text-xs flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${
                      r.status === "succeeded"
                        ? "bg-success"
                        : r.status === "failed"
                          ? "bg-destructive"
                          : r.status === "fallback"
                            ? "bg-warning"
                            : "bg-muted-foreground/50"
                    }`}
                    aria-hidden
                  />
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {r.model}
                  </span>
                  {r.error_msg ? (
                    <span className="text-destructive truncate">
                      · {r.error_msg}
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  <RelativeTime iso={r.created_at} /> · {r.duration_ms}ms
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
