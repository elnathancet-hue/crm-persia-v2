"use client";

import { useEffect, useState, useCallback } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getTags, createTag } from "@/actions/tags";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { Tag, Plus, Loader2, X } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
];

export default function TagsPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const focusTrapRef = useFocusTrap(showCreate);
  useEscapeKey(showCreate, useCallback(() => setShowCreate(false), []));

  function load() {
    if (!isManagingClient) return;
    setLoading(true);
    getTags().then((d) => { setTags(d); setLoading(false); });
  }

  useEffect(() => { load(); }, [activeOrgId]);

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Tags</h1>
          <p className="text-sm text-muted-foreground">{tags.length} tags</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm">
          <Plus className="size-4" /> Nova Tag
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : tags.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Tag className="size-12 mx-auto text-muted-foreground/30" />
          <p className="text-lg text-muted-foreground/60">Nenhuma tag criada</p>
          <p className="text-sm text-muted-foreground/50">Tags ajudam a organizar seus leads</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {tags.map((tag) => (
            <div key={tag.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
              <div className="size-8 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
              <div>
                <p className="text-sm font-medium text-foreground">{tag.name}</p>
                <p className="text-[10px] text-muted-foreground/60 font-mono">{tag.color}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCreate(false)} />
          <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="create-tag-title" className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 id="create-tag-title" className="text-lg font-semibold text-foreground">Nova Tag</h2>
              <button onClick={() => setShowCreate(false)} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
            </div>
            <CreateTagForm onCreated={() => { setShowCreate(false); load(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function CreateTagForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
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
    const { error } = await createTag(name, color);
    if (error) toast.error(error); else { toast.success("Tag criada"); onCreated(); }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
        <input value={name} onChange={e => { setName(e.target.value); clearFieldError("name"); }} onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.name ? "border-red-500" : "border-border"}`} />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-2">Cor</label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`size-8 rounded-full transition-all ${color === c ? "ring-2 ring-white ring-offset-2 ring-offset-card scale-110" : "hover:scale-105"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2">{saving && <Loader2 className="size-4 animate-spin" />}Criar</button>
      </div>
    </form>
  );
}
