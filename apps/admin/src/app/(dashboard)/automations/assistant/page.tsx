"use client";

import { useEffect, useState, useCallback } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getAssistants, createAssistant, updateAssistant, toggleAssistant, deleteAssistant } from "@/actions/automations";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { Bot, Plus, Loader2, Trash2, X, Pencil } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

const CATEGORIES: Record<string, { label: string; color: string }> = {
  geral: { label: "Geral", color: "bg-gray-500" },
  vendas: { label: "Vendas", color: "bg-emerald-500" },
  suporte: { label: "Suporte", color: "bg-blue-500" },
  educacao: { label: "Educação", color: "bg-purple-500" },
  consultoria: { label: "Consultoria", color: "bg-orange-500" },
};

const TONES = [
  { value: "formal", label: "Formal" },
  { value: "amigavel", label: "Amigável" },
  { value: "casual", label: "Casual" },
];

export default function AssistantPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [assistants, setAssistants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const focusTrapRef = useFocusTrap(showModal);
  useEscapeKey(showModal, useCallback(() => setShowModal(false), []));

  function load() {
    if (!isManagingClient) return;
    setLoading(true);
    getAssistants().then((d) => { setAssistants(d); setLoading(false); });
  }

  useEffect(() => { load(); }, [activeOrgId]);

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Assistentes IA</h1>
          <p className="text-sm text-muted-foreground">{assistants.length} assistentes</p>
        </div>
        <button onClick={() => { setEditingId(null); setShowModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm">
          <Plus className="size-4" /> Novo Assistente
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : assistants.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Bot className="size-12 mx-auto text-muted-foreground/30" />
          <p className="text-lg text-muted-foreground/60">Nenhum assistente configurado</p>
          <p className="text-sm text-muted-foreground/50">Configure um assistente IA para atender seus leads</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {assistants.map((a) => {
            const cat = CATEGORIES[a.category] || CATEGORIES.geral;
            return (
              <div key={a.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-foreground">{a.name}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${cat.color}`}>{cat.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground/60 mt-1 line-clamp-2">{a.prompt?.slice(0, 100)}...</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditingId(a.id); setShowModal(true); }} aria-label="Editar" className="text-muted-foreground/60 hover:text-foreground p-1"><Pencil className="size-3.5" /></button>
                    <button onClick={() => { if (confirm("Excluir?")) { deleteAssistant(a.id); load(); } }} aria-label="Excluir" className="text-muted-foreground/60 hover:text-red-500 p-1"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-muted-foreground">Tom: {TONES.find(t => t.value === a.tone)?.label || a.tone}</span>
                  <button onClick={() => { toggleAssistant(a.id, !a.is_active); load(); }} className={`text-xs px-2 py-0.5 rounded-full ${a.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                    {a.is_active ? "Ativo" : "Inativo"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowModal(false)} />
          <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="assistant-modal-title" className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 id="assistant-modal-title" className="text-lg font-semibold text-foreground">{editingId ? "Editar" : "Novo"} Assistente</h2>
              <button onClick={() => setShowModal(false)} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
            </div>
            <AssistantForm editing={editingId ? assistants.find(a => a.id === editingId) : null} onSaved={() => { setShowModal(false); setEditingId(null); load(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantForm({ editing, onSaved }: { editing: any; onSaved: () => void }) {
  const [name, setName] = useState(editing?.name || "");
  const [prompt, setPrompt] = useState(editing?.prompt || "");
  const [category, setCategory] = useState(editing?.category || "geral");
  const [tone, setTone] = useState(editing?.tone || "amigavel");
  const [welcomeMsg, setWelcomeMsg] = useState(editing?.welcome_msg || "");
  const [offHoursMsg, setOffHoursMsg] = useState(editing?.off_hours_msg || "");
  const [splitterEnabled, setSplitterEnabled] = useState(editing?.message_splitting?.enabled || false);
  const [splitterThreshold, setSplitterThreshold] = useState(editing?.message_splitting?.threshold || 100);
  const [splitterDelay, setSplitterDelay] = useState(editing?.message_splitting?.delay_seconds || 2);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let valid = true; const newErrors: Record<string, string> = {};
    if (!name.trim()) { newErrors.name = "Campo obrigatório"; valid = false; }
    if (!prompt.trim()) { newErrors.prompt = "Campo obrigatório"; valid = false; }
    else if (prompt.trim().length < 20) { newErrors.prompt = "Mínimo 20 caracteres"; valid = false; }
    if (!valid) { setErrors(newErrors); return; }
    setSaving(true);
    if (editing) {
      const { error } = await updateAssistant(editing.id, { name, prompt, category, tone, welcome_msg: welcomeMsg, off_hours_msg: offHoursMsg, message_splitting: { enabled: splitterEnabled, threshold: splitterThreshold, delay_seconds: splitterDelay } });
      if (error) toast.error(error); else { toast.success("Atualizado"); onSaved(); }
    } else {
      const { error } = await createAssistant({ name, prompt, category, tone, welcome_msg: welcomeMsg, off_hours_msg: offHoursMsg });
      if (error) toast.error(error); else { toast.success("Criado"); onSaved(); }
    }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
        <input value={name} onChange={e => { setName(e.target.value); clearFieldError("name"); }} onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.name ? "border-red-500" : "border-border"}`} />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Prompt *</label>
        <textarea value={prompt} onChange={e => { setPrompt(e.target.value); clearFieldError("prompt"); }} onBlur={() => { if (!prompt.trim()) setFieldError("prompt", "Campo obrigatório"); else if (prompt.trim().length < 20) setFieldError("prompt", "Mínimo 20 caracteres"); }} rows={5} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary resize-none ${errors.prompt ? "border-red-500" : "border-border"}`} />
        {errors.prompt && <p className="text-xs text-red-500 mt-1">{errors.prompt}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-muted-foreground block mb-1">Categoria</label><select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none">{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div><label className="text-xs text-muted-foreground block mb-1">Tom</label><select value={tone} onChange={e => setTone(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none">{TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
      </div>
      <div><label className="text-xs text-muted-foreground block mb-1">Msg Boas-vindas</label><input value={welcomeMsg} onChange={e => setWelcomeMsg(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary" /></div>
      <div><label className="text-xs text-muted-foreground block mb-1">Msg Fora do Horário</label><input value={offHoursMsg} onChange={e => setOffHoursMsg(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary" /></div>

      {/* Picotador / Message Splitter */}
      <div className="bg-muted border border-border rounded-lg p-3 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={splitterEnabled} onChange={(e) => setSplitterEnabled(e.target.checked)} className="accent-primary" />
          <span className="text-sm text-foreground">Picotador de mensagens</span>
        </label>
        <p className="text-[10px] text-muted-foreground/60">Quebra mensagens longas da IA em partes menores para parecer mais natural.</p>
        {splitterEnabled && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Limite (caracteres)</label>
              <input type="number" value={splitterThreshold} onChange={e => setSplitterThreshold(Number(e.target.value))} min={50} max={500} className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Delay entre msgs (seg)</label>
              <input type="number" value={splitterDelay} onChange={e => setSplitterDelay(Number(e.target.value))} min={1} max={10} className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground outline-none" />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2">{saving && <Loader2 className="size-4 animate-spin" />}{editing ? "Salvar" : "Criar"}</button>
      </div>
    </form>
  );
}
