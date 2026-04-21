"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getSegments, createSegment, updateSegment, deleteSegment } from "@/actions/segments";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { Filter, Plus, Loader2, Trash2, X, Pencil, Users } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

interface Condition {
  field: string;
  op: string;
  value: string;
}

interface Rules {
  operator: string;
  conditions: Condition[];
}

const FIELDS = [
  { value: "status", label: "Status" },
  { value: "source", label: "Origem" },
  { value: "channel", label: "Canal" },
  { value: "score", label: "Score" },
  { value: "tags", label: "Tags" },
  { value: "created_at", label: "Data de criação" },
  { value: "last_interaction_at", label: "Última interação" },
];

const OPS_BY_FIELD: Record<string, { value: string; label: string }[]> = {
  status: [{ value: "eq", label: "Igual" }, { value: "neq", label: "Diferente" }],
  source: [{ value: "eq", label: "Igual" }, { value: "neq", label: "Diferente" }],
  channel: [{ value: "eq", label: "Igual" }],
  score: [{ value: "gt", label: "Maior que" }, { value: "lt", label: "Menor que" }, { value: "gte", label: "Maior ou igual" }, { value: "lte", label: "Menor ou igual" }],
  tags: [{ value: "contains", label: "Contém" }, { value: "not_contains", label: "Não contém" }],
  created_at: [{ value: "older_than_days", label: "Há mais de X dias" }, { value: "newer_than_days", label: "Há menos de X dias" }],
  last_interaction_at: [{ value: "older_than_days", label: "Há mais de X dias" }, { value: "newer_than_days", label: "Há menos de X dias" }, { value: "is_null", label: "Nunca interagiu" }],
};

export default function SegmentsPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSegment, setEditingSegment] = useState<any>(null);

  function load() {
    if (!isManagingClient) return;
    setLoading(true);
    getSegments().then((d) => { setSegments(d); setLoading(false); });
  }

  useEffect(() => { load(); }, [activeOrgId]);

  async function handleDelete(id: string) {
    if (!confirm("Excluir este segmento?")) return;
    const { error } = await deleteSegment(id);
    if (error) toast.error(error);
    else { toast.success("Segmento excluído"); load(); }
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Segmentações</h1>
          <p className="text-sm text-muted-foreground">{segments.length} segmentos</p>
        </div>
        <button onClick={() => { setEditingSegment(null); setShowModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm">
          <Plus className="size-4" /> Novo Segmento
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : segments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Filter className="size-12 mx-auto text-muted-foreground/30" />
          <p className="text-lg text-muted-foreground/60">Nenhum segmento criado</p>
          <p className="text-sm text-muted-foreground/50">Segmente seus leads para campanhas direcionadas</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {segments.map((seg) => {
            const rules = seg.rules as Rules | null;
            const condCount = rules?.conditions?.length || 0;
            return (
              <div key={seg.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{seg.name}</h3>
                    {seg.description && <p className="text-xs text-muted-foreground/60 mt-1">{seg.description}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditingSegment(seg); setShowModal(true); }} aria-label="Editar" className="text-muted-foreground/60 hover:text-foreground p-1"><Pencil className="size-3.5" /></button>
                    <button onClick={() => handleDelete(seg.id)} aria-label="Excluir" className="text-muted-foreground/60 hover:text-red-500 p-1"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Users className="size-3" />{seg.lead_count || 0} leads</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Filter className="size-3" />{condCount} regras</span>
                  {rules?.operator && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{rules.operator}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <SegmentModal
          editing={editingSegment}
          onClose={() => { setShowModal(false); setEditingSegment(null); }}
          onSaved={() => { setShowModal(false); setEditingSegment(null); load(); }}
        />
      )}
    </div>
  );
}

// ---- Segment Modal with Condition Builder ----

function SegmentModal({ editing, onClose, onSaved }: { editing: any; onClose: () => void; onSaved: () => void }) {
  const existingRules = editing?.rules as Rules | null;
  const [name, setName] = useState(editing?.name || "");
  const [description, setDescription] = useState(editing?.description || "");
  const [operator, setOperator] = useState(existingRules?.operator || "AND");
  const [conditions, setConditions] = useState<Condition[]>(existingRules?.conditions || []);
  const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  // Parallel stable ids — positionally aligned with conditions, used as React keys
  const [condIds, setCondIds] = useState<string[]>(() => (existingRules?.conditions || []).map(() => genId()));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const focusTrapRef = useFocusTrap(true);
  useEscapeKey(true, onClose);

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  function addCondition() {
    setConditions([...conditions, { field: "status", op: "eq", value: "" }]);
    setCondIds([...condIds, genId()]);
  }

  function updateCondition(index: number, updates: Partial<Condition>) {
    setConditions(conditions.map((c, i) => i === index ? { ...c, ...updates } : c));
  }

  function removeCondition(index: number) {
    setConditions(conditions.filter((_, i) => i !== index));
    setCondIds(condIds.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let valid = true; const newErrors: Record<string, string> = {};
    if (!name.trim()) { newErrors.name = "Campo obrigatório"; valid = false; }
    if (!valid) { setErrors(newErrors); return; }
    setSaving(true);
    const rules: Rules = { operator, conditions };

    if (editing) {
      const { error } = await updateSegment(editing.id, { name, description, rules });
      if (error) toast.error(error); else { toast.success("Segmento atualizado"); onSaved(); }
    } else {
      const { error } = await createSegment({ name, description, rules });
      if (error) toast.error(error); else { toast.success("Segmento criado"); onSaved(); }
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="segment-modal-title" className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 id="segment-modal-title" className="text-lg font-semibold text-foreground">{editing ? "Editar" : "Novo"} Segmento</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
              <input value={name} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }} onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.name ? "border-red-500" : "border-border"}`} />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Descrição</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary" />
            </div>
          </div>

          {/* Operator toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Combinar regras com:</span>
            <div className="flex bg-muted border border-border rounded-lg overflow-hidden">
              <button type="button" onClick={() => setOperator("AND")} className={`px-3 py-1 text-xs font-medium transition-colors ${operator === "AND" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>E (AND)</button>
              <button type="button" onClick={() => setOperator("OR")} className={`px-3 py-1 text-xs font-medium transition-colors ${operator === "OR" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>OU (OR)</button>
            </div>
          </div>

          {/* Conditions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Regras</label>
              <button type="button" onClick={addCondition} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"><Plus className="size-3" />Adicionar regra</button>
            </div>

            {conditions.length === 0 && (
              <p className="text-xs text-muted-foreground/60 text-center py-4">Nenhuma regra. Clique em "Adicionar regra".</p>
            )}

            {conditions.map((cond, i) => {
              const ops = OPS_BY_FIELD[cond.field] || [];
              const needsValue = cond.op !== "is_null";
              return (
                <div key={condIds[i] ?? `cond-${i}`} className="flex items-center gap-2 bg-muted border border-border rounded-lg p-2">
                  {/* Field */}
                  <select value={cond.field} onChange={(e) => { const f = e.target.value; const newOps = OPS_BY_FIELD[f] || []; updateCondition(i, { field: f, op: newOps[0]?.value || "eq", value: "" }); }} className="px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground outline-none flex-1">
                    {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>

                  {/* Operator */}
                  <select value={cond.op} onChange={(e) => updateCondition(i, { op: e.target.value })} className="px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground outline-none flex-1">
                    {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>

                  {/* Value */}
                  {needsValue && (
                    <input value={cond.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="Valor" className="px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground placeholder-muted-foreground/60 outline-none flex-1" />
                  )}

                  {/* Remove */}
                  <button type="button" onClick={() => removeCondition(i)} aria-label="Remover regra" className="text-muted-foreground/60 hover:text-red-500 shrink-0 p-1"><X className="size-3.5" /></button>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />}{editing ? "Salvar" : "Criar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
