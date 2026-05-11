"use client";

import { useEffect, useState } from "react";
import { ReactivateAgentButton } from "@persia/ai-agent-ui";
import { LeadCommentsTab } from "@persia/leads-ui";
import { getLeadDetail, updateLead, getLeadActivities } from "@/actions/leads";
import {
  getLeadAgentHandoffState,
  reactivateAgent as reactivateLeadAgent,
} from "@/actions/ai-agent/reactivate";
import { getTags, addTagToLead, removeTagFromLead } from "@/actions/tags";
import { createDeal, getPipelines } from "@/actions/pipelines";
import { ArrowLeft, Loader2, Save, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { useActiveOrg } from "@/lib/stores/client-store";

const STATUS_OPTIONS = [
  { value: "new", label: "Novo" },
  { value: "contacted", label: "Contatado" },
  { value: "qualified", label: "Qualificado" },
  { value: "customer", label: "Cliente" },
  { value: "lost", label: "Perdido" },
];

interface Props {
  leadId: string;
  onBack: () => void;
}

export function LeadDetail({ leadId, onBack }: Props) {
  const { activeOrgId } = useActiveOrg();
  const [lead, setLead] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [handoffState, setHandoffState] = useState<{
    isPaused: boolean;
    pausedAt: string | null;
    reason: string | null;
    pausedConversationCount: number;
  }>({
    isPaused: false,
    pausedAt: null,
    reason: null,
    pausedConversationCount: 0,
  });
  const [allTags, setAllTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showCreateDeal, setShowCreateDeal] = useState(false);
  const [creatingDeal, setCreatingDeal] = useState(false);
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [selectedStageId, setSelectedStageId] = useState("");
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [dealError, setDealError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  useEffect(() => {
    if (!activeOrgId) return;

    Promise.all([
      getLeadDetail(leadId),
      getLeadActivities(leadId),
      getTags(),
      getLeadAgentHandoffState(activeOrgId, leadId),
    ]).then(([leadResult, actResult, tagsResult, nextHandoffState]) => {
      if (leadResult.data) {
        setLead(leadResult.data);
        setName(leadResult.data.name || "");
        setPhone(leadResult.data.phone || "");
        setEmail(leadResult.data.email || "");
        setStatus(leadResult.data.status || "");
      }
      setActivities(actResult.data || []);
      setAllTags(tagsResult);
      setHandoffState(nextHandoffState);
      setLoading(false);
    });
  }, [activeOrgId, leadId]);

  useEffect(() => {
    if (!showCreateDeal) return;

    setDealTitle(lead?.name ? `Negocio - ${lead.name}` : "Novo negocio");
    setDealError("");

    getPipelines()
      .then((data) => {
        const pipelineList = (data || []) as any[];
        setPipelines(pipelineList);
        const firstPipeline = pipelineList[0];
        setSelectedPipelineId(firstPipeline?.id || "");
        setSelectedStageId(firstPipeline?.pipeline_stages?.[0]?.id || "");
      })
      .catch(() => {
        setPipelines([]);
        setSelectedPipelineId("");
        setSelectedStageId("");
      });
  }, [showCreateDeal, lead?.name]);

  async function handleSave() {
    let valid = true; const newErrors: Record<string, string> = {};
    if (!name.trim()) { newErrors.name = "Campo obrigatório"; valid = false; }
    if (!valid) { setErrors(newErrors); return; }
    setSaving(true);
    const { error } = await updateLead(leadId, { name, phone, email, status });
    if (error) toast.error(error);
    else toast.success("Lead atualizado");
    setSaving(false);
  }

  async function handleAddTag(tagId: string) {
    const { error } = await addTagToLead(leadId, tagId);
    if (error) toast.error(error);
    else {
      const tag = allTags.find((t) => t.id === tagId);
      setLead((prev: any) => ({
        ...prev,
        lead_tags: [...(prev.lead_tags || []), { tag_id: tagId, tags: tag }],
      }));
    }
    setShowTagPicker(false);
  }

  async function handleRemoveTag(tagId: string) {
    const { error } = await removeTagFromLead(leadId, tagId);
    if (error) toast.error(error);
    else {
      setLead((prev: any) => ({
        ...prev,
        lead_tags: (prev.lead_tags || []).filter((lt: any) => lt.tag_id !== tagId),
      }));
    }
  }

  async function handleCreateDeal() {
    if (!selectedPipelineId || !selectedStageId || !dealTitle.trim()) {
      setDealError("Preencha titulo, funil e etapa.");
      return;
    }

    setDealError("");
    setCreatingDeal(true);

    const created = await createDeal({
      pipeline_id: selectedPipelineId,
      stage_id: selectedStageId,
      title: dealTitle.trim(),
      value: parseFloat(dealValue) || 0,
      lead_id: leadId,
    });

    if (!created) {
      toast.error("Nao foi possivel criar o negocio");
      setCreatingDeal(false);
      return;
    }

    toast.success("Negocio criado no CRM");
    setShowCreateDeal(false);
    setCreatingDeal(false);
    setDealValue("");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  if (!lead) return <p className="text-muted-foreground/60 text-center py-20">Lead não encontrado</p>;

  const leadTagIds = new Set((lead.lead_tags || []).map((lt: any) => lt.tag_id));
  const availableTags = allTags.filter((t) => !leadTagIds.has(t.id));
  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const stageOptions = (selectedPipeline?.pipeline_stages || []) as any[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="text-xl font-bold text-foreground">{lead.name || "Lead"}</h1>
        </div>
        {activeOrgId && handoffState.isPaused ? (
          <ReactivateAgentButton
            pausedAt={handoffState.pausedAt}
            reason={handoffState.reason}
            pausedConversationCount={handoffState.pausedConversationCount}
            onReactivate={() => reactivateLeadAgent(activeOrgId, leadId)}
            onSuccess={async () => {
              const [leadResult, actResult, nextHandoffState] = await Promise.all([
                getLeadDetail(leadId),
                getLeadActivities(leadId),
                getLeadAgentHandoffState(activeOrgId, leadId),
              ]);
              if (leadResult.data) setLead(leadResult.data);
              setActivities(actResult.data || []);
              setHandoffState(nextHandoffState);
            }}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Edit form */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Dados do Lead</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
                <input value={name} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }} onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.name ? "border-red-500" : "border-border"}`} />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Telefone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none">
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm disabled:opacity-50">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar
              </button>
            </div>
          </div>

          {/* Tags */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Tags</h2>
              <div className="relative">
                <button onClick={() => setShowTagPicker(!showTagPicker)} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
                  <Tag className="size-3" /> Adicionar
                </button>
                {showTagPicker && availableTags.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowTagPicker(false)} />
                    <div className="absolute right-0 top-full mt-1 w-48 bg-muted border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
                      {availableTags.map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => handleAddTag(tag.id)}
                          className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2"
                        >
                          <span className="size-3 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(lead.lead_tags || []).map((lt: any) => (
                <span
                  key={lt.tag_id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full"
                  style={{ backgroundColor: lt.tags.color + "30", color: lt.tags.color }}
                >
                  {lt.tags.name}
                  <button onClick={() => handleRemoveTag(lt.tag_id)} aria-label="Remover tag" className="hover:opacity-70">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {(lead.lead_tags || []).length === 0 && <span className="text-xs text-muted-foreground/60">Nenhuma tag</span>}
            </div>
          </div>

          {/* CRM */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">CRM</h2>
              <button
                onClick={() => setShowCreateDeal((v) => !v)}
                className="text-xs text-primary hover:text-primary/80"
              >
                {showCreateDeal ? "Fechar" : "Criar negocio"}
              </button>
            </div>

            {showCreateDeal ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Titulo *</label>
                  <input
                    value={dealTitle}
                    onChange={(e) => setDealTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary"
                    placeholder="Nome do negocio"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Valor (R$)</label>
                  <input
                    value={dealValue}
                    onChange={(e) => setDealValue(e.target.value)}
                    type="number"
                    step="0.01"
                    className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Funil *</label>
                  <select
                    value={selectedPipelineId}
                    onChange={(e) => {
                      const pipelineId = e.target.value;
                      setSelectedPipelineId(pipelineId);
                      const pipeline = pipelines.find((p) => p.id === pipelineId);
                      setSelectedStageId((pipeline?.pipeline_stages || [])[0]?.id || "");
                    }}
                    className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none"
                  >
                    <option value="">Selecione...</option>
                    {pipelines.map((pipeline) => (
                      <option key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Etapa *</label>
                  <select
                    value={selectedStageId}
                    onChange={(e) => setSelectedStageId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none"
                  >
                    <option value="">Selecione...</option>
                    {stageOptions.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                  </select>
                </div>
                {dealError && (
                  <p className="text-xs text-red-500 md:col-span-2">{dealError}</p>
                )}
                <div className="md:col-span-2 flex justify-end">
                  <button
                    onClick={handleCreateDeal}
                    disabled={creatingDeal}
                    className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2"
                  >
                    {creatingDeal && <Loader2 className="size-4 animate-spin" />}
                    Criar no CRM
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/70">
                Crie um negocio para este lead sem sair desta tela.
              </p>
            )}
          </div>
        </div>

        {/* Right: Activity */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">Atividades</h2>
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {activities.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">Nenhuma atividade registrada</p>
            ) : (
              activities.map((act) => (
                <div key={act.id} className="border-l-2 border-border pl-3">
                  <p className="text-xs text-foreground">{act.description}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {new Date(act.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* PR-S1: Comentarios colaborativos — superadmin pode ler e
          escrever em nome do org gerenciado. Members empty na v1 (admin
          nao tem getOrgMembers action — @mention renderiza sem
          destaque de membros). */}
      <div className="mt-6 bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
          Comentários internos
        </h2>
        <LeadCommentsTab leadId={leadId} open members={[]} />
      </div>
    </div>
  );
}
