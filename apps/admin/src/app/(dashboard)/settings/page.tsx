"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getOrgSettings, updateOrgSettings } from "@/actions/settings";
import { Building2, Loader2, Save } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

const NICHE_OPTIONS = ["Estética", "Educação", "Saúde", "Imobiliária", "Varejo", "Serviços", "Tecnologia", "Alimentação", "Outro"];

export default function OrgSettingsPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  useEffect(() => {
    if (!isManagingClient) { setLoading(false); return; }
    setLoading(true);
    getOrgSettings().then((data) => {
      setOrg(data);
      setName(data?.name || "");
      setNiche(data?.niche || "");
      setServices((data?.services as Record<string, boolean>) || {});
      setLoading(false);
    });
  }, [activeOrgId]);

  async function handleSave() {
    if (!isManagingClient) { toast.error("Nenhuma organização selecionada"); return; }
    let valid = true; const newErrors: Record<string, string> = {};
    if (!name.trim()) { newErrors.name = "Campo obrigatório"; valid = false; }
    if (!valid) { setErrors(newErrors); return; }
    setSaving(true);
    const { error } = await updateOrgSettings({ name, niche, services });
    if (error) toast.error(error);
    else toast.success("Configurações salvas");
    setSaving(false);
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>;

  const serviceLabels: Record<string, string> = {
    chat: "Chat", crm: "CRM", leads: "Leads", groups: "Grupos",
    automations: "Automações", campaigns: "Campanhas", reports: "Relatórios",
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Dados da Organização</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
            <input value={name} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }} onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.name ? "border-red-500" : "border-border"}`} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nicho</label>
            <select value={niche} onChange={(e) => setNiche(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none">
              <option value="">Selecionar</option>
              {NICHE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Plano</label>
            <input value={org?.plan || "trial"} disabled className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-muted-foreground/60 cursor-not-allowed" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Slug</label>
            <input value={org?.slug || ""} disabled className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-muted-foreground/60 cursor-not-allowed" />
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Serviços</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(serviceLabels).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={services[key] ?? false}
                onChange={(e) => setServices({ ...services, [key]: e.target.checked })}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm disabled:opacity-50">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar
        </button>
      </div>
    </div>
  );
}
