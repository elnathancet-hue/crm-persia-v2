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
} from "lucide-react";
import type { LeadWithTags, StageOutcome } from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
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
import {
  getLeadDealsList,
  getLeadStats,
  updateLead,
  type LeadDealItem,
  type LeadStats,
} from "@/actions/leads";
import { getLeadOpenDealWithStages, updateDealStage } from "@/actions/crm";
import {
  getLeadCustomFields,
  setLeadCustomFieldValue,
  type LeadCustomFieldDef,
  type LeadCustomFieldEntry,
} from "@/actions/custom-fields";
import {
  createLeadComment,
  deleteLeadComment,
  getLeadComments,
  updateLeadComment,
  type LeadComment,
} from "@/actions/lead-comments";
import { useCurrentUser } from "@/lib/realtime/use-current-user";
import { useLeadPresence } from "@/lib/realtime/use-lead-presence";
import { Switch } from "@persia/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";

// Buckets pra agrupar stages no Popover do subheader. Espelha o
// schema de outcome (Fase 1) e as cores usadas no Kanban.
const OUTCOME_LABEL: Record<StageOutcome, string> = {
  em_andamento: "EM ANDAMENTO",
  falha: "FALHA",
  bem_sucedido: "BEM-SUCEDIDO",
};
const OUTCOME_COLOR: Record<StageOutcome, string> = {
  em_andamento: "text-purple-700",
  falha: "text-red-600",
  bem_sucedido: "text-emerald-600",
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
}: Props) {
  const [form, setForm] = React.useState<FormState>(() =>
    leadToFormState(lead),
  );
  const [isPending, startTransition] = React.useTransition();

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
  const currentUser = useCurrentUser();
  const [commentsBump, setCommentsBump] = React.useState(0);
  const { watchers, othersCount } = useLeadPresence({
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
    if (!open) return;
    let cancelled = false;
    getLeadOpenDealWithStages(lead.id)
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
  }, [open, lead.id]);

  // PR-D: busca stats do lead em paralelo (Negocios + Conversas + Activities).
  // Falha silenciosa — cards mostram "—" se nao conseguir carregar.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatsLoading(true);
    getLeadStats(lead.id)
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
  }, [open, lead.id]);

  function handleChangeStage(newStageId: string) {
    if (!currentDeal || newStageId === currentDeal.stage_id) return;
    const previousStageId = currentDeal.stage_id;
    setCurrentDeal({ ...currentDeal, stage_id: newStageId });
    setStageChangePending(true);
    updateDealStage(currentDeal.id, newStageId)
      .then(() => toast.success("Etapa atualizada"))
      .catch((err) => {
        // Revert
        setCurrentDeal((prev) =>
          prev ? { ...prev, stage_id: previousStageId } : prev,
        );
        toast.error(err instanceof Error ? err.message : "Erro ao mover");
      })
      .finally(() => setStageChangePending(false));
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

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        // updateLead agora aceita objeto direto (alem de FormData),
        // entao mandamos todos os campos do drawer numa unica chamada.
        await updateLead(lead.id, {
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
        toast.success("Lead atualizado");
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
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-hidden p-0 flex flex-col"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border bg-card shrink-0">
          <div className="flex items-start justify-between gap-3">
            <SheetTitle>Informações do lead</SheetTitle>
            <PresenceAvatars
              watchers={watchers}
              othersCount={othersCount}
              currentUserId={currentUser?.user_id ?? null}
            />
          </div>
          {currentStageObj ? (
            <SheetDescription className="flex items-center gap-1.5 text-xs">
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
            </SheetDescription>
          ) : currentStageName ? (
            // Fallback display estatico (caller pode ainda passar
            // currentStageName mesmo sem deal aberto — ex: contexto
            // sem permissao de edicao).
            <SheetDescription className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Etapa atual:</span>
              <span className="font-medium text-cyan-600">
                {currentStageName}
              </span>
            </SheetDescription>
          ) : null}
        </SheetHeader>

        {/* PR-D: header rico — 3 cards de stats (Negocios / Conversas /
            Atividades). Mostram count + info "de uma olhada" pro agente
            entender historico do lead sem trocar de tab/pagina. */}
        <LeadStatsCards stats={stats} loading={statsLoading} />

        <Tabs defaultValue="dados" className="flex-1 flex flex-col">
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
            className="flex-1 overflow-y-auto px-5 py-4 space-y-6"
          >
            <TabsContent value="dados" className="space-y-6 mt-0">
              {/* ============ CONTATO ============ */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Contact className="size-4 text-cyan-600" />
                  CONTATO
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Nome">
                    <Input
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Nome do contato"
                    />
                  </Field>
                  <Field label="E-mail">
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="email@exemplo.com"
                    />
                  </Field>
                  <Field label="Celular">
                    <Input
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      placeholder="+55 (00) 00000-0000"
                    />
                  </Field>
                  <Field label="Telefone">
                    <Input
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
                        <SelectValue placeholder="Selecione" />
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
                      type="url"
                      value={form.website}
                      onChange={(e) => set("website", e.target.value)}
                      placeholder="https://..."
                    />
                  </Field>
                </div>
              </section>

              {/* ============ ENDEREÇO ============ */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <MapPin className="size-4 text-cyan-600" />
                  ENDEREÇO
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="País">
                    <Input
                      value={form.address_country}
                      onChange={(e) => set("address_country", e.target.value)}
                      placeholder="Brasil"
                    />
                  </Field>
                  <Field label="Estado">
                    <Input
                      value={form.address_state}
                      onChange={(e) => set("address_state", e.target.value)}
                      placeholder="SP"
                    />
                  </Field>
                  <Field label="Cidade">
                    <Input
                      value={form.address_city}
                      onChange={(e) => set("address_city", e.target.value)}
                      placeholder="São Paulo"
                    />
                  </Field>
                  <Field label="CEP">
                    <Input
                      value={form.address_zip}
                      onChange={(e) => set("address_zip", e.target.value)}
                      placeholder="00000-000"
                    />
                  </Field>
                  <Field label="Endereço">
                    <Input
                      value={form.address_street}
                      onChange={(e) => set("address_street", e.target.value)}
                      placeholder="Rua, Av..."
                    />
                  </Field>
                  <Field label="Número">
                    <Input
                      value={form.address_number}
                      onChange={(e) => set("address_number", e.target.value)}
                      placeholder="123"
                    />
                  </Field>
                  <Field label="Bairro" className="sm:col-span-1">
                    <Input
                      value={form.address_neighborhood}
                      onChange={(e) =>
                        set("address_neighborhood", e.target.value)
                      }
                      placeholder="Bairro"
                    />
                  </Field>
                  <Field label="Complemento" className="sm:col-span-2">
                    <Input
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
              <LeadComentariosTab
                leadId={lead.id}
                open={open}
                members={members}
                reloadVersion={commentsBump}
              />
            </TabsContent>
          </form>
        </Tabs>

        <SheetFooter className="px-5 py-3 border-t border-border bg-card shrink-0 flex-row justify-end gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Fechar
          </Button>
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
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
  const [entries, setEntries] = React.useState<LeadCustomFieldEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [savingFieldId, setSavingFieldId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getLeadCustomFields(leadId)
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
  }, [open, leadId]);

  async function handleSave(fieldId: string, newValue: string) {
    // Otimista: atualiza state local imediato
    setEntries((prev) =>
      prev.map((e) =>
        e.field.id === fieldId ? { ...e, value: newValue } : e,
      ),
    );
    setSavingFieldId(fieldId);
    try {
      await setLeadCustomFieldValue(leadId, fieldId, newValue);
      // Sem toast em cada save — auto-save deve ser silencioso.
      // Se quiser feedback, mostrar dot pequeno "salvo" no field.
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao salvar campo",
      );
      // Reload entries pra reverter o otimista que falhou
      try {
        const res = await getLeadCustomFields(leadId);
        setEntries(res);
      } catch {
        /* swallow */
      }
    } finally {
      setSavingFieldId(null);
    }
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
    <div className="grid grid-cols-3 gap-2 px-5 py-3 bg-muted/30 border-b border-border shrink-0">
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
              ? `Última msg: ${formatRelativeShort(
                  stats.conversations.last_message_at,
                )}`
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
  detail: string;
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

function formatRelativeShort(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const month = Math.floor(day / 30);
  return `${month}mes`;
}

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
  const [deals, setDeals] = React.useState<LeadDealItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getLeadDealsList(leadId)
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
  }, [open, leadId]);

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

      {/* Footer: criado ha X */}
      <p className="mt-2 text-[10px] text-muted-foreground/70 tabular-nums">
        Criado {formatRelativeShort(deal.created_at)}
      </p>
    </a>
  );
}

// ============================================================================
// PR-M: LeadComentariosTab — comentarios colaborativos no lead
// ----------------------------------------------------------------------------
// Flat (sem threaded replies). Lista cronologica + form criar.
// Editar/deletar so do proprio comentario (RLS garante).
// @mencao: parser client-side renderiza @nome como link visual.
//
// Loading: skeleton 2 linhas. Empty: hint friendly.
// Optimistic: comentario aparece imediato; em caso de erro, reverte.
// ============================================================================

function LeadComentariosTab({
  leadId,
  open,
  members,
  reloadVersion,
}: {
  leadId: string;
  open: boolean;
  members: Member[];
  /** PR-P: bump incrementado pelo drawer pai quando o canal de
   *  presence/comments dispara evento. Tab refetcha a lista. */
  reloadVersion: number;
}) {
  const [comments, setComments] = React.useState<LeadComment[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [newContent, setNewContent] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingContent, setEditingContent] = React.useState("");
  const [savingEdit, setSavingEdit] = React.useState(false);

  // Identifica o autor logado a partir das matches dos comentarios.
  // Hack: server retorna author_id mas nao temos current user id no
  // drawer. Comparacao indireta: assumimos que o user pode editar
  // comentario se o nome do autor bate com algum membro... NAO, isso
  // e fragil. Vou armazenar author_id retornado e comparar via membro
  // logado — mas o drawer nao recebe currentUserId.
  // Solucao: pedir RLS pra fazer a guarda — botao Edit/Delete aparece
  // sempre, click chama action; se nao for autor, action falha com
  // erro RLS-permission-denied. Reverte otimismo.
  // Pra UX melhor, o user da prop members deveria incluir current
  // user.id. Por ora, deixar botoes sempre visiveis e tratar erro.
  // ATUALIZACAO: melhor abordagem — filtrar via members (membro
  // logado deve estar na lista). Vou aceitar todos por ora.

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLeadComments(leadId);
      setComments(res);
    } catch (err) {
      console.error("[LeadComentariosTab] failed:", err);
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    reload().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [open, reload]);

  // PR-P Realtime: o drawer pai assina presence + comments num canal
  // so (`lead-${leadId}`) e bumpa reloadVersion quando algo muda.
  // Aqui so reagimos ao bump pra refetch. Estrategia simples: refetch
  // completo (lista curta, <50 comentarios por lead).
  React.useEffect(() => {
    if (!open || reloadVersion === 0) return;
    void reload();
  }, [reloadVersion, open, reload]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await createLeadComment(leadId, newContent);
      setComments((prev) => [...prev, created]);
      setNewContent("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao criar comentário",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(commentId: string) {
    if (!editingContent.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      await updateLeadComment(commentId, editingContent);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, content: editingContent.trim(), updated_at: new Date().toISOString() }
            : c,
        ),
      );
      setEditingId(null);
      setEditingContent("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(commentId: string) {
    if (!confirm("Excluir este comentário?")) return;
    try {
      await deleteLeadComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  }

  return (
    <div className="space-y-4">
      {/* Lista de comentarios */}
      {loading ? (
        <div className="space-y-2 py-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 w-full bg-muted rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <MessageSquare className="size-5 mx-auto mb-2 text-muted-foreground/60" />
          <p className="font-medium text-foreground">
            Nenhum comentário ainda
          </p>
          <p className="mt-1 text-xs">
            Use comentários internos para passar contexto entre agentes
            sobre este lead. Mencione um colega com @nome.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              members={members}
              isEditing={editingId === c.id}
              editingContent={editingContent}
              savingEdit={savingEdit}
              onStartEdit={() => {
                setEditingId(c.id);
                setEditingContent(c.content);
              }}
              onChangeEdit={setEditingContent}
              onCancelEdit={() => {
                setEditingId(null);
                setEditingContent("");
              }}
              onSaveEdit={() => handleSaveEdit(c.id)}
              onDelete={() => handleDelete(c.id)}
            />
          ))}
        </ul>
      )}

      {/* Form criar */}
      <form
        onSubmit={handleCreate}
        className="space-y-2 rounded-lg border border-border bg-card p-3"
      >
        <Textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value.slice(0, 2000))}
          placeholder="Escreva um comentário interno... Use @nome para mencionar um colega."
          rows={3}
          maxLength={2000}
          className="resize-none border-0 focus-visible:ring-0 bg-transparent text-sm p-0"
          disabled={submitting}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground/70">
            {newContent.length}/2000 · só visível pra equipe
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={!newContent.trim() || submitting}
            className="h-8 rounded-md gap-1.5"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Comentar
          </Button>
        </div>
      </form>
    </div>
  );
}

// Item individual de comentario com edit/delete inline.
function CommentItem({
  comment,
  members,
  isEditing,
  editingContent,
  savingEdit,
  onStartEdit,
  onChangeEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  comment: LeadComment;
  members: Member[];
  isEditing: boolean;
  editingContent: string;
  savingEdit: boolean;
  onStartEdit: () => void;
  onChangeEdit: (v: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  const authorName = comment.author_name?.trim() || "Autor desconhecido";
  const initials = authorName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  // Avatar color hash
  const avatarColor = React.useMemo(() => {
    const palette = [
      "bg-blue-500",
      "bg-emerald-500",
      "bg-amber-500",
      "bg-rose-500",
      "bg-violet-500",
      "bg-cyan-500",
    ];
    const seed = authorName
      .split("")
      .reduce((a, c) => a + c.charCodeAt(0), 0);
    return palette[seed % palette.length];
  }, [authorName]);

  // Editado?
  const isEdited = comment.updated_at !== comment.created_at;

  return (
    <li className="flex gap-2.5 rounded-lg p-2.5 hover:bg-muted/40 transition-colors group">
      <span
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ${avatarColor}`}
        aria-hidden
      >
        {initials || "?"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground">
            {authorName}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatRelativeShort(comment.created_at)}
            {isEdited && " · editado"}
          </span>
          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            {!isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                      aria-label="Mais opções"
                    >
                      ⋯
                    </button>
                  }
                />
                <DropdownMenuContent align="end" className="w-32">
                  <DropdownMenuItem onClick={onStartEdit}>
                    <Pencil className="size-3.5" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={onDelete}
                  >
                    <Trash2 className="size-3.5" />
                    Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="mt-1 space-y-1">
            <Textarea
              value={editingContent}
              onChange={(e) => onChangeEdit(e.target.value.slice(0, 2000))}
              rows={3}
              maxLength={2000}
              className="resize-none text-sm"
              disabled={savingEdit}
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancelEdit}
                disabled={savingEdit}
                className="h-7"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSaveEdit}
                disabled={!editingContent.trim() || savingEdit}
                className="h-7"
              >
                {savingEdit ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-sm text-foreground whitespace-pre-wrap break-words">
            {renderCommentContent(comment.content, members)}
          </p>
        )}
      </div>
    </li>
  );
}

// Renderiza @mencoes como badges visuais. Parser simples:
// matches @\w+ no inicio ou apos whitespace. Membro com primeiro
// nome igual fica destacado em primary. Outros @ ficam visualmente
// como tag mas sem link.
function renderCommentContent(content: string, members: Member[]): React.ReactNode {
  const memberFirstNames = new Set(
    members
      .map((m) => (m.name || "").split(/\s+/)[0]?.toLowerCase())
      .filter(Boolean),
  );

  const parts: React.ReactNode[] = [];
  // Regex captura @nome (alphanumeric + acentos), preservando posicoes
  const regex = /(?:^|(?<=\s))@([\p{L}\p{N}_]+)/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before) parts.push(before);
    const mention = match[1];
    const isKnown = memberFirstNames.has(mention.toLowerCase());
    parts.push(
      <span
        key={`m-${key++}`}
        className={`inline-flex items-center rounded px-1 ${
          isKnown
            ? "bg-primary/10 text-primary font-medium"
            : "bg-muted text-muted-foreground"
        }`}
      >
        @{mention}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  const after = content.slice(lastIndex);
  if (after) parts.push(after);
  return parts.length > 0 ? parts : content;
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
