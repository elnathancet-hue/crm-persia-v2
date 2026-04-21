"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Search, Building2, MoreHorizontal, Pencil, Trash2, Loader2 } from "lucide-react";
import { createOrganization, deleteOrganization } from "@/actions/admin";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { toast } from "sonner";

interface Org { id: string; name: string; niche: string | null; plan: string; category: string | null; created_at: string; organization_members: { count: number }[] }

const SERVICES_DEFAULTS = { chat: true, crm: true, leads: true, groups: true, automations: true, campaigns: false, reports: true };
const SERVICES_LIST = [
  { key: "chat", label: "Chat Live" }, { key: "crm", label: "CRM" }, { key: "leads", label: "Leads" },
  { key: "groups", label: "Grupos" }, { key: "automations", label: "Automações" }, { key: "campaigns", label: "Campanhas" }, { key: "reports", label: "Relatórios" },
];

export function ClientsList({ initialOrgs }: { initialOrgs: Org[] }) {
  const [orgs, setOrgs] = React.useState<Org[]>(initialOrgs);
  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [ownerName, setOwnerName] = React.useState("");
  const [niche, setNiche] = React.useState("");
  const [category, setCategory] = React.useState("empresa");
  const [cpfCnpj, setCpfCnpj] = React.useState("");
  const [services, setServices] = React.useState<Record<string, boolean>>(SERVICES_DEFAULTS);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const focusTrapRef = useFocusTrap(createOpen);
  useEscapeKey(createOpen, React.useCallback(() => setCreateOpen(false), []));

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  function resetForm() {
    setName(""); setEmail(""); setPassword(""); setPhone(""); setOwnerName(""); setNiche(""); setCategory("empresa"); setCpfCnpj("");
    setServices(SERVICES_DEFAULTS); setErrors({});
  }

  async function handleCreate() {
    let valid = true; const newErrors: Record<string, string> = {};
    if (!name.trim()) { newErrors.name = "Campo obrigatório"; valid = false; }
    if (!email.trim()) { newErrors.email = "Campo obrigatório"; valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { newErrors.email = "Email inválido"; valid = false; }
    if (!password) { newErrors.password = "Campo obrigatório"; valid = false; }
    else if (password.length < 6) { newErrors.password = "Mínimo 6 caracteres"; valid = false; }
    if (!valid) { setErrors(newErrors); return; }
    setSaving(true);
    try {
      const org = await createOrganization({ name: name.trim(), email: email.trim().toLowerCase(), password, phone: phone.trim() || undefined, ownerName: ownerName.trim() || undefined, niche: niche.trim() || undefined, category, cpfCnpj: cpfCnpj.trim() || undefined, services });
      setOrgs((prev) => [{ ...org, organization_members: [{ count: 1 }] } as Org, ...prev]);
      toast.success("Cliente criado!"); setCreateOpen(false); resetForm();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro"); } finally { setSaving(false); }
  }

  async function handleDelete(id: string, orgName: string) {
    if (!confirm(`Excluir "${orgName}" e TODOS os dados?`)) return;
    try { await deleteOrganization(id); setOrgs((prev) => prev.filter((o) => o.id !== id)); toast.success("Removido"); } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro"); }
  }

  const filtered = orgs.filter((o) => !search || o.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} clientes</span>
        <button onClick={() => { resetForm(); setCreateOpen(true); }} className="h-9 px-4 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/80 flex items-center gap-2">
          <Plus className="size-4" />Novo Cliente
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl bg-card p-12 text-center">
          <Building2 className="size-10 text-muted-foreground/60 mx-auto mb-3" />
          <p className="font-semibold">Nenhum cliente</p>
          <button onClick={() => { resetForm(); setCreateOpen(true); }} className="mt-4 h-9 px-4 rounded-md bg-primary text-white text-sm font-medium">
            <Plus className="size-4 inline mr-1" />Criar primeiro cliente
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((org) => (
            <div key={org.id} className="relative border border-border rounded-xl bg-card p-4 hover:border-primary/30 transition-colors group">
              <Link href={`/clients/${org.id}`} className="absolute inset-0 z-0 rounded-xl" />
              <div className="flex items-start justify-between relative">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">{(org.name || "?")[0].toUpperCase()}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{org.name}</p>
                    <p className="text-[10px] text-muted-foreground">{org.plan} - {org.niche || "Sem nicho"}</p>
                  </div>
                </div>
                <div className="relative z-10 group/menu">
                  <button aria-label="Mais opcoes" className="size-7 flex items-center justify-center rounded-md hover:bg-muted"><MoreHorizontal className="size-4 text-muted-foreground" /></button>
                  <div className="hidden group-focus-within/menu:block absolute right-0 top-8 z-10 w-40 rounded-lg border border-border bg-card shadow-lg py-1">
                    <Link href={`/clients/${org.id}`} className="block px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"><Pencil className="size-3.5" />Editar</Link>
                    <button onClick={() => handleDelete(org.id, org.name)} className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-muted flex items-center gap-2"><Trash2 className="size-3.5" />Excluir</button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground relative">
                <span>{org.organization_members?.[0]?.count || 0} membros</span>
                <span>{new Date(org.created_at).toLocaleDateString("pt-BR")}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setCreateOpen(false)}>
          <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="create-client-title" className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 id="create-client-title" className="text-lg font-bold mb-1">Adicionar Cliente</h2>
            <p className="text-sm text-muted-foreground mb-4">Crie uma conta completa para seu cliente</p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Categoria</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1">
                  <option value="empresa">Empresa</option><option value="autonomo">Autônomo</option><option value="agencia">Agência</option><option value="infoprodutor">Infoprodutor</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Serviços</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {SERVICES_LIST.map((s) => (
                    <label key={s.key} className="flex items-center justify-between rounded-md border border-border p-2 cursor-pointer">
                      <span className="text-xs">{s.label}</span>
                      <input type="checkbox" checked={services[s.key] ?? false} onChange={(e) => setServices((p) => ({ ...p, [s.key]: e.target.checked }))}
                        className="size-4 rounded accent-primary" />
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-muted-foreground">Nome da Empresa *</label>
                  <input value={name} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }} onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }} className={`w-full h-9 rounded-md border bg-muted px-3 text-sm mt-1 ${errors.name ? "border-red-500" : "border-border"}`} />
                  {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}</div>
                <div><label className="text-xs font-medium text-muted-foreground">Responsável</label>
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1" /></div>
              </div>

              <div><label className="text-xs font-medium text-muted-foreground">E-mail *</label>
                <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); clearFieldError("email"); }} onBlur={() => { if (!email.trim()) setFieldError("email", "Campo obrigatório"); else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) setFieldError("email", "Email inválido"); }} className={`w-full h-9 rounded-md border bg-muted px-3 text-sm mt-1 ${errors.email ? "border-red-500" : "border-border"}`} />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}</div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-muted-foreground">CPF/CNPJ</label>
                  <input value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1" /></div>
                <div><label className="text-xs font-medium text-muted-foreground">Telefone</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1" /></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-muted-foreground">Nicho</label>
                  <input value={niche} onChange={(e) => setNiche(e.target.value)} className="w-full h-9 rounded-md border border-border bg-muted px-3 text-sm mt-1" /></div>
                <div><label className="text-xs font-medium text-muted-foreground">Senha *</label>
                  <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); clearFieldError("password"); }} onBlur={() => { if (!password) setFieldError("password", "Campo obrigatório"); else if (password.length < 6) setFieldError("password", "Mínimo 6 caracteres"); }} className={`w-full h-9 rounded-md border bg-muted px-3 text-sm mt-1 ${errors.password ? "border-red-500" : "border-border"}`} />
                  {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}</div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 justify-end">
              <button onClick={() => setCreateOpen(false)} className="h-9 px-4 rounded-md border border-border text-sm hover:bg-muted">Cancelar</button>
              <button onClick={handleCreate} disabled={saving} className="h-9 px-4 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/80 disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="size-4 animate-spin" />}{saving ? "Criando..." : "Criar Conta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
