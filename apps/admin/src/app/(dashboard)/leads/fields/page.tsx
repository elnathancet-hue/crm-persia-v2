"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getCustomFields, createCustomField, updateCustomField, deleteCustomField } from "@/actions/custom-fields";
import { Columns3, Plus, Loader2, Trash2, X, Pencil } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

const FIELD_TYPES: { value: string; label: string }[] = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "select", label: "Seleção" },
  { value: "multi_select", label: "Seleção Múltipla" },
  { value: "boolean", label: "Sim/Não" },
  { value: "url", label: "URL" },
  { value: "phone", label: "Telefone" },
  { value: "email", label: "Email" },
];

function slugify(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export default function CustomFieldsPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [fields, setFields] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingField, setEditingField] = useState<any>(null);

  function load() {
    if (!isManagingClient) return;
    setLoading(true);
    getCustomFields().then((d) => { setFields(d); setLoading(false); });
  }

  useEffect(() => { load(); }, [activeOrgId]);

  async function handleDelete(id: string) {
    if (!confirm("Excluir este campo? Todos os valores serão removidos.")) return;
    const { error } = await deleteCustomField(id);
    if (error) toast.error(error);
    else { toast.success("Campo excluído"); load(); }
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Campos Personalizados</h1>
          <p className="text-sm text-muted-foreground">{fields.length} campos</p>
        </div>
        <button onClick={() => { setEditingField(null); setShowModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm">
          <Plus className="size-4" /> Novo Campo
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : fields.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Columns3 className="size-10 mb-2 text-muted-foreground/30" /><p>Nenhum campo personalizado</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Chave</th>
                <th className="text-left px-4 py-3 font-medium">Tipo</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Opções</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Obrigatório</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => {
                const typeLabel = FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type;
                return (
                  <tr key={f.id} className="border-b border-accent">
                    <td className="px-4 py-3 text-sm text-foreground font-medium">{f.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground/60 font-mono hidden md:table-cell">{f.field_key}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{typeLabel}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground/60 hidden lg:table-cell">
                      {f.options && Array.isArray(f.options) ? f.options.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-xs ${f.is_required ? "text-amber-400" : "text-muted-foreground/60"}`}>{f.is_required ? "Sim" : "Não"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditingField(f); setShowModal(true); }} className="text-muted-foreground/60 hover:text-foreground p-1"><Pencil className="size-3.5" /></button>
                        <button onClick={() => handleDelete(f.id)} className="text-muted-foreground/60 hover:text-red-500 p-1"><Trash2 className="size-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <FieldModal editing={editingField} onClose={() => { setShowModal(false); setEditingField(null); }} onSaved={() => { setShowModal(false); setEditingField(null); load(); }} />
      )}
    </div>
  );
}

function FieldModal({ editing, onClose, onSaved }: { editing: any; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(editing?.name || "");
  const [fieldKey, setFieldKey] = useState(editing?.field_key || "");
  const [fieldType, setFieldType] = useState(editing?.field_type || "text");
  const [options, setOptions] = useState(editing?.options ? (editing.options as string[]).join(", ") : "");
  const [isRequired, setIsRequired] = useState(editing?.is_required || false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  // Auto-generate key from name (only on create)
  useEffect(() => {
    if (!editing) setFieldKey(slugify(name));
  }, [name, editing]);

  const showOptions = fieldType === "select" || fieldType === "multi_select";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let valid = true; const newErrors: Record<string, string> = {};
    if (!name.trim()) { newErrors.name = "Campo obrigatório"; valid = false; }
    if (!fieldType) { newErrors.fieldType = "Campo obrigatório"; valid = false; }
    if (!valid) { setErrors(newErrors); return; }
    setSaving(true);
    if (editing) {
      const { error } = await updateCustomField(editing.id, { name, field_type: fieldType, options: showOptions ? options : undefined, is_required: isRequired });
      if (error) toast.error(error); else { toast.success("Campo atualizado"); onSaved(); }
    } else {
      const { error } = await createCustomField({ name, field_key: fieldKey, field_type: fieldType, options: showOptions ? options : undefined, is_required: isRequired });
      if (error) toast.error(error); else { toast.success("Campo criado"); onSaved(); }
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{editing ? "Editar" : "Novo"} Campo</h2>
          <button onClick={onClose} className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
            <input value={name} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }} onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.name ? "border-red-500" : "border-border"}`} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Chave</label>
            <input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} disabled={!!editing} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none font-mono disabled:opacity-50 disabled:cursor-not-allowed" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Tipo *</label>
            <select value={fieldType} onChange={(e) => { setFieldType(e.target.value); clearFieldError("fieldType"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none ${errors.fieldType ? "border-red-500" : "border-border"}`}>
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {errors.fieldType && <p className="text-xs text-red-500 mt-1">{errors.fieldType}</p>}
          </div>
          {showOptions && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Opções (separadas por vírgula)</label>
              <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="opção1, opção2, opção3" className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary" />
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="accent-primary" />
            <span className="text-sm text-foreground">Campo obrigatório</span>
          </label>
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
