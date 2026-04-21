"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getAssistants, createAssistant, updateAssistant, toggleAssistant, deleteAssistant } from "@/actions/settings";
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

export default function AIPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [assistants, setAssistants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function loadAssistants() {
    if (!isManagingClient) return;
    setLoading(true);
    getAssistants().then((data) => { setAssistants(data); setLoading(false); });
  }

  useEffect(() => { loadAssistants(); }, [activeOrgId]);

  async function handleToggle(id: string, active: boolean) {
    const { error } = await toggleAssistant(id, !active);
    if (error) toast.error(error);
    else loadAssistants();
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este assistente?")) return;
    const { error } = await deleteAssistant(id);
    if (error) toast.error(error);
    else { toast.success("Assistente excluído"); loadAssistants(); }
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{assistants.length} assistentes</p>
        <button onClick={() => { setEditingId(null); setShowModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm">
          <Plus className="size-4" /> Novo Assistente
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : assistants.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Bot className="size-10 mb-2 text-muted-foreground/30" /><p>Nenhum assistente IA configurado</p>
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
                    <button onClick={() => { setEditingId(a.id); setShowModal(true); }} className="text-muted-foreground/60 hover:text-foreground p-1"><Pencil className="size-3.5" /></button>
                    <button onClick={() => handleDelete(a.id)} className="text-muted-foreground/60 hover:text-red-500 p-1"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Tom: {TONES.find(t => t.value === a.tone)?.label || a.tone}</span>
                  </div>
                  <button onClick={() => handleToggle(a.id, a.is_active)} className={`text-xs px-2 py-0.5 rounded-full ${a.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                    {a.is_active ? "Ativo" : "Inativo"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <AssistantModal
          editingAssistant={editingId ? assistants.find(a => a.id === editingId) : null}
          onClose={() => { setShowModal(false); setEditingId(null); }}
          onSaved={() => { setShowModal(false); setEditingId(null); loadAssistants(); }}
        />
      )}
    </div>
  );
}

function AssistantModal({ editingAssistant, onClose, onSaved }: {
  editingAssistant: any | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(editingAssistant?.name || "");
  const [prompt, setPrompt] = useState(editingAssistant?.prompt || "");
  const [category, setCategory] = useState(editingAssistant?.category || "geral");
  const [tone, setTone] = useState(editingAssistant?.tone || "amigavel");
  const [welcomeMsg, setWelcomeMsg] = useState(editingAssistant?.welcome_msg || "");
  const [offHoursMsg, setOffHoursMsg] = useState(editingAssistant?.off_hours_msg || "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    if (editingAssistant) {
      const { error } = await updateAssistant(editingAssistant.id, { name, prompt, category, tone, welcome_msg: welcomeMsg, off_hours_msg: offHoursMsg });
      if (error) toast.error(error);
      else { toast.success("Assistente atualizado"); onSaved(); }
    } else {
      const { error } = await createAssistant({ name, prompt, category, tone, welcome_msg: welcomeMsg, off_hours_msg: offHoursMsg });
      if (error) toast.error(error);
      else { toast.success("Assistente criado"); onSaved(); }
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{editingAssistant ? "Editar" : "Novo"} Assistente</h2>
          <button onClick={onClose} className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary" required />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Prompt (instrucoes) *</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary resize-none" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Categoria</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none">
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Tom</label>
              <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none">
                {TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Mensagem de Boas-vindas</label>
            <input value={welcomeMsg} onChange={(e) => setWelcomeMsg(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Mensagem Fora do Horário</label>
            <input value={offHoursMsg} onChange={(e) => setOffHoursMsg(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">Cancelar</button>
            <button type="submit" disabled={saving || !name || !prompt} className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />} {editingAssistant ? "Salvar" : "Criar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
