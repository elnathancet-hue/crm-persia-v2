"use client";

import { useEffect, useState, useCallback } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getWebhooks, createWebhook, toggleWebhookActive, deleteWebhook } from "@/actions/settings";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { Webhook, Plus, Loader2, Trash2, X, Copy, Check } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

export default function WebhooksPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const focusTrapRef = useFocusTrap(showCreate);
  useEscapeKey(showCreate, useCallback(() => setShowCreate(false), []));

  function loadWebhooks() {
    if (!isManagingClient) return;
    setLoading(true);
    getWebhooks().then((data) => { setWebhooks(data); setLoading(false); });
  }

  useEffect(() => { loadWebhooks(); }, [activeOrgId]);

  async function handleToggle(id: string, active: boolean) {
    const { error } = await toggleWebhookActive(id, !active);
    if (error) toast.error(error);
    else loadWebhooks();
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este webhook?")) return;
    const { error } = await deleteWebhook(id);
    if (error) toast.error(error);
    else { toast.success("Webhook excluido"); loadWebhooks(); }
  }

  function copyToken(token: string, id: string) {
    navigator.clipboard.writeText(token);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Token copiado");
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{webhooks.length} webhooks</p>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm">
          <Plus className="size-4" /> Novo Webhook
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : webhooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Webhook className="size-10 mb-2 text-muted-foreground/30" /><p>Nenhum webhook configurado</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium">Direcao</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">URL / Token</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((wh) => (
                <tr key={wh.id} className="border-b border-accent">
                  <td className="px-4 py-3 text-sm text-foreground">{wh.name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${wh.direction === "inbound" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"}`}>
                      {wh.direction === "inbound" ? "Entrada" : "Saida"}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {wh.direction === "inbound" && wh.token ? (
                      <button onClick={() => copyToken(wh.token, wh.id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-mono">
                        {wh.token.slice(0, 12)}...
                        {copiedId === wh.id ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground/60 truncate max-w-[200px] block">{wh.url || "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(wh.id, wh.is_active)} className={`text-xs px-2 py-0.5 rounded-full ${wh.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                      {wh.is_active ? "Ativo" : "Inativo"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(wh.id)} aria-label="Excluir" className="text-muted-foreground/60 hover:text-red-500"><Trash2 className="size-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCreate(false)} />
          <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="create-webhook-title" className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 id="create-webhook-title" className="text-lg font-semibold text-foreground">Novo Webhook</h2>
              <button onClick={() => setShowCreate(false)} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
            </div>
            <CreateWebhookForm onCreated={() => { setShowCreate(false); loadWebhooks(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function CreateWebhookForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [direction, setDirection] = useState("outbound");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let valid = true; const newErrors: Record<string, string> = {};
    if (!name.trim()) { newErrors.name = "Campo obrigatório"; valid = false; }
    if (direction === "outbound") {
      if (!url.trim()) { newErrors.url = "Campo obrigatório"; valid = false; }
      else { try { new URL(url); } catch { newErrors.url = "URL inválida"; valid = false; } }
    }
    if (!events.trim()) { newErrors.events = "Campo obrigatório"; valid = false; }
    if (!valid) { setErrors(newErrors); return; }
    setSaving(true);
    const { error } = await createWebhook({ name, direction, url, events });
    if (error) toast.error(error);
    else { toast.success("Webhook criado"); onCreated(); }
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
        <label className="text-xs text-muted-foreground block mb-1">Direcao</label>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none">
          <option value="outbound">Saida (envia dados)</option>
          <option value="inbound">Entrada (recebe dados)</option>
        </select>
      </div>
      {direction === "outbound" && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">URL *</label>
          <input value={url} onChange={(e) => { setUrl(e.target.value); clearFieldError("url"); }} onBlur={() => { if (!url.trim()) setFieldError("url", "Campo obrigatório"); else { try { new URL(url); } catch { setFieldError("url", "URL inválida"); } } }} placeholder="https://..." className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary ${errors.url ? "border-red-500" : "border-border"}`} />
          {errors.url && <p className="text-xs text-red-500 mt-1">{errors.url}</p>}
        </div>
      )}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Eventos *</label>
        <input value={events} onChange={(e) => { setEvents(e.target.value); clearFieldError("events"); }} onBlur={() => { if (!events.trim()) setFieldError("events", "Campo obrigatório"); }} placeholder="lead.created, message.received" className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary ${errors.events ? "border-red-500" : "border-border"}`} />
        {errors.events && <p className="text-xs text-red-500 mt-1">{errors.events}</p>}
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="size-4 animate-spin" />} Criar
        </button>
      </div>
    </form>
  );
}
