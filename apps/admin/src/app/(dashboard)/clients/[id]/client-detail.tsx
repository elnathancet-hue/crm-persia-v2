"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Save, Loader2, Users, MessageSquare, Phone, Smartphone, CheckCircle2, XCircle } from "lucide-react";
import { updateOrganization, connectWhatsAppInstance } from "@/actions/admin";
import { toast } from "sonner";

const SERVICES_LIST = [
  { key: "chat", label: "Chat Live" }, { key: "crm", label: "CRM" }, { key: "leads", label: "Leads" },
  { key: "groups", label: "Grupos" }, { key: "automations", label: "Automações" }, { key: "campaigns", label: "Campanhas" }, { key: "reports", label: "Relatórios" },
];
const ROLE_LABELS: Record<string, string> = { owner: "Dono", admin: "Admin", gestor: "Gestor", usuario: "Usuário", viewer: "Viewer" };

export function ClientDetail({ data }: { data: any }) {
  const { org, members, stats, whatsapp } = data;
  const [name, setName] = React.useState(org.name || "");
  const [niche, setNiche] = React.useState(org.niche || "");
  const [plan, setPlan] = React.useState(org.plan || "trial");
  const [category, setCategory] = React.useState(org.category || "empresa");
  const [services, setServices] = React.useState<Record<string, boolean>>(org.services || {});
  const [saving, setSaving] = React.useState(false);

  const [waUrl, setWaUrl] = React.useState(whatsapp?.instanceUrl || "");
  const [waToken, setWaToken] = React.useState(whatsapp?.instanceToken || "");
  const [waPhone, setWaPhone] = React.useState(whatsapp?.phoneNumber || "");
  const [waSaving, setWaSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    try { await updateOrganization(org.id, { name, niche, plan, category, services }); toast.success("Salvo!"); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro"); } finally { setSaving(false); }
  }

  async function handleConnectWa() {
    if (!waUrl.trim() || !waToken.trim()) { toast.error("URL e token obrigatorios"); return; }
    setWaSaving(true);
    try { await connectWhatsAppInstance(org.id, waUrl.trim(), waToken.trim(), waPhone.trim() || undefined); toast.success("Instancia conectada!"); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro"); } finally { setWaSaving(false); }
  }

  const isWaConnected = stats.whatsappStatus === "connected";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/clients"><button className="size-8 rounded-md hover:bg-muted flex items-center justify-center"><ArrowLeft className="size-4" /></button></Link>
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-lg font-bold text-primary">{(org.name || "?")[0].toUpperCase()}</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
              <p className="text-xs text-muted-foreground">{plan} - {category}</p>
            </div>
          </div>
        </div>
        <Link
          href={`/clients/${org.id}/agenda`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          <CalendarDays className="size-4" />
          Abrir Agenda
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Users, label: "Leads", value: stats.leads, color: "text-blue-500" },
          { icon: MessageSquare, label: "Conversas", value: stats.conversations, color: "text-green-500" },
          { icon: isWaConnected ? CheckCircle2 : XCircle, label: "WhatsApp", value: isWaConnected ? "Conectado" : "Desconectado", color: isWaConnected ? "text-green-500" : "text-muted-foreground" },
          { icon: Phone, label: "Número", value: stats.whatsappPhone || "-", color: "text-muted-foreground" },
        ].map((s) => (
          <div key={s.label} className="border border-border rounded-xl bg-card p-4 flex items-center gap-3">
            <s.icon className={`size-5 ${s.color}`} />
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-sm font-medium">{s.value}</p></div>
          </div>
        ))}
      </div>

      {/* Edit */}
      <div className="border border-border rounded-xl bg-card p-6 space-y-4">
        <h2 className="font-semibold">Dados da Conta</h2>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="text-xs text-muted-foreground">Nome</label><input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1" /></div>
          <div><label className="text-xs text-muted-foreground">Nicho</label><input value={niche} onChange={(e) => setNiche(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1" /></div>
          <div><label className="text-xs text-muted-foreground">Categoria</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1">
              <option value="empresa">Empresa</option><option value="autonomo">Autonomo</option><option value="agencia">Agencia</option><option value="infoprodutor">Infoprodutor</option>
            </select></div>
          <div><label className="text-xs text-muted-foreground">Plano</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1">
              <option value="trial">Trial</option><option value="starter">Starter</option><option value="pro">Pro</option><option value="scale">Scale</option>
            </select></div>
        </div>
      </div>

      {/* Services */}
      <div className="border border-border rounded-xl bg-card p-6 space-y-3">
        <h2 className="font-semibold">Servicos Habilitados</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {SERVICES_LIST.map((s) => (
            <label key={s.key} className="flex items-center justify-between rounded-lg border border-border p-3 cursor-pointer">
              <span className="text-sm">{s.label}</span>
              <input type="checkbox" checked={services[s.key] ?? false} onChange={(e) => setServices((p) => ({ ...p, [s.key]: e.target.checked }))} className="size-4 accent-primary" />
            </label>
          ))}
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="h-9 px-4 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/80 disabled:opacity-50 flex items-center gap-2">
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? "Salvando..." : "Salvar Alteracoes"}
      </button>

      {/* WhatsApp Instance */}
      <div className="border border-border rounded-xl bg-card p-6 space-y-4">
        <div className="flex items-center gap-2"><Smartphone className="size-5" /><h2 className="font-semibold">WhatsApp</h2></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="text-xs text-muted-foreground">URL da Instancia</label><input placeholder="https://instancia.exemplo.com" value={waUrl} onChange={(e) => setWaUrl(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1" /></div>
          <div><label className="text-xs text-muted-foreground">Token</label><input placeholder="token-uuid" value={waToken} onChange={(e) => setWaToken(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1" /></div>
          <div><label className="text-xs text-muted-foreground">Numero</label><input placeholder="5586999999999" value={waPhone} onChange={(e) => setWaPhone(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1" /></div>
        </div>
        <button onClick={handleConnectWa} disabled={waSaving} className="h-9 px-4 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/80 disabled:opacity-50 flex items-center gap-2">
          {waSaving ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}{waSaving ? "Salvando..." : whatsapp ? "Atualizar Instancia" : "Conectar Instancia"}
        </button>
      </div>

      {/* Members */}
      <div className="border border-border rounded-xl bg-card p-6 space-y-3">
        <h2 className="font-semibold">Membros ({members.length})</h2>
        {members.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum membro</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="text-left py-2">Nome</th><th className="text-left py-2">Email</th><th className="text-left py-2">Funcao</th><th className="text-left py-2">Status</th></tr></thead>
            <tbody>
              {members.map((m: any) => (
                <tr key={m.id} className="border-b border-border">
                  <td className="py-2 font-medium">{m.name}</td>
                  <td className="py-2 text-muted-foreground">{m.email}</td>
                  <td className="py-2"><span className="px-2 py-0.5 rounded-full bg-muted text-xs">{ROLE_LABELS[m.role] || m.role}</span></td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded-full text-xs ${m.is_active ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>{m.is_active ? "Ativo" : "Inativo"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
