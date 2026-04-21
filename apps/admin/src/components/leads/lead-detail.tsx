"use client";

import { useEffect, useState } from "react";
import { getLeadDetail, updateLead, getLeadActivities } from "@/actions/leads";
import { getTags, addTagToLead, removeTagFromLead } from "@/actions/tags";
import { ArrowLeft, Loader2, Save, Tag, X } from "lucide-react";
import { toast } from "sonner";

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
  const [lead, setLead] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  useEffect(() => {
    Promise.all([
      getLeadDetail(leadId),
      getLeadActivities(leadId),
      getTags(),
    ]).then(([leadResult, actResult, tagsResult]) => {
      if (leadResult.data) {
        setLead(leadResult.data);
        setName(leadResult.data.name || "");
        setPhone(leadResult.data.phone || "");
        setEmail(leadResult.data.email || "");
        setStatus(leadResult.data.status);
      }
      setActivities(actResult.data || []);
      setAllTags(tagsResult);
      setLoading(false);
    });
  }, [leadId]);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-xl font-bold text-foreground">{lead.name || "Lead"}</h1>
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
    </div>
  );
}
