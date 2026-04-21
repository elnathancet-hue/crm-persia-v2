"use client";

import { useEffect, useState, useCallback } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getQueues, createQueue, deleteQueue } from "@/actions/settings";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { ListChecks, Plus, Loader2, Trash2, X, Users } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

const DISTRIBUTION_LABELS: Record<string, string> = {
  round_robin: "Round Robin",
  random: "Aleatorio",
  least_busy: "Menos Ocupado",
  manual: "Manual",
};

export default function QueuesPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [queues, setQueues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const focusTrapRef = useFocusTrap(showCreate);
  useEscapeKey(showCreate, useCallback(() => setShowCreate(false), []));

  function loadQueues() {
    if (!isManagingClient) return;
    setLoading(true);
    getQueues().then((data) => { setQueues(data); setLoading(false); });
  }

  useEffect(() => { loadQueues(); }, [activeOrgId]);

  async function handleDelete(id: string) {
    if (!confirm("Excluir esta fila?")) return;
    const { error } = await deleteQueue(id);
    if (error) toast.error(error);
    else { toast.success("Fila excluida"); loadQueues(); }
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{queues.length} filas</p>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm">
          <Plus className="size-4" /> Nova Fila
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : queues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <ListChecks className="size-10 mb-2 text-muted-foreground/30" /><p>Nenhuma fila criada</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {queues.map((q) => (
            <div key={q.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{q.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{DISTRIBUTION_LABELS[q.distribution_type] || q.distribution_type}</p>
                </div>
                <button onClick={() => handleDelete(q.id)} aria-label="Excluir" className="text-muted-foreground/60 hover:text-red-500">
                  <Trash2 className="size-4" />
                </button>
              </div>
              {q.description && <p className="text-xs text-muted-foreground/60 mt-2">{q.description}</p>}
              <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                <Users className="size-3" /> {q.member_count} membros
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCreate(false)} />
          <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="create-queue-title" className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 id="create-queue-title" className="text-lg font-semibold text-foreground">Nova Fila</h2>
              <button onClick={() => setShowCreate(false)} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
            </div>
            <CreateQueueForm onCreated={() => { setShowCreate(false); loadQueues(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function CreateQueueForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [distributionType, setDistributionType] = useState("round_robin");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let valid = true; const newErrors: Record<string, string> = {};
    if (!name.trim()) { newErrors.name = "Campo obrigatório"; valid = false; }
    if (!valid) { setErrors(newErrors); return; }
    setSaving(true);
    const { error } = await createQueue({ name, description, distribution_type: distributionType });
    if (error) toast.error(error);
    else { toast.success("Fila criada"); onCreated(); }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
        <input value={name} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }} onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.name ? "border-red-500" : "border-border"}`} />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Descricao</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Tipo de Distribuicao</label>
        <select value={distributionType} onChange={(e) => setDistributionType(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none">
          {Object.entries(DISTRIBUTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="size-4 animate-spin" />} Criar
        </button>
      </div>
    </form>
  );
}
