"use client";

import { useEffect, useState, useRef } from "react";
import { useClientStore } from "@/lib/stores/client-store";
import { getOrganizations, updateOrganization, switchAdminContext } from "@/actions/admin";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { Search, X, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Org {
  id: string;
  name: string;
  category: string | null;
  plan: string;
  services: Record<string, boolean> | null;
}

import { hashColor, getInitials } from "@/lib/utils";

export function ClientSidebar() {
  const { selectedClientId, panelOpen, setClient, closePanel } = useClientStore();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [confirmOrg, setConfirmOrg] = useState<Org | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Org | null>(null);

  useEffect(() => {
    getOrganizations().then((data) => {
      setOrgs(data.map((o: any) => ({
        id: o.id, name: o.name, category: o.category, plan: o.plan,
        services: o.services,
      })));
    });
  }, []);

  function refreshOrgs() {
    getOrganizations().then((data) => {
      setOrgs(data.map((o: any) => ({
        id: o.id, name: o.name, category: o.category, plan: o.plan,
        services: o.services,
      })));
    });
  }

  if (!panelOpen) return null;

  return (
    <>
      {/* Right panel */}
      <aside className="w-[72px] flex flex-col border-l border-border bg-background h-screen sticky top-0 items-center shrink-0 animate-in slide-in-from-right duration-200">
        {/* Search button */}
        <div className="py-3 w-full flex justify-center">
          <button
            onClick={() => setShowSearch(true)}
            className="size-10 bg-card border border-border rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
            title="Pesquisar contas"
            aria-label="Pesquisar contas"
          >
            <Search className="size-4" />
          </button>
        </div>

        {/* Separator */}
        <div className="w-10 border-t border-border mb-2" />

        {/* Client avatars */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-2 py-1 w-full">
          {orgs.slice(0, 20).map((org) => {
            const isSelected = org.id === selectedClientId;
            return (
              <button
                key={org.id}
                onClick={() => setConfirmOrg(org)}
                className={`group relative flex flex-col items-center gap-0.5 transition-all ${
                  isSelected ? "scale-105" : "opacity-70 hover:opacity-100"
                }`}
                title={org.name}
              >
                <div
                  className={`size-10 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 transition-all ${
                    isSelected
                      ? "ring-primary ring-offset-2 ring-offset-background"
                      : "ring-transparent hover:ring-muted-foreground/60"
                  } ${hashColor(org.name)}`}
                >
                  {getInitials(org.name)}
                </div>
                <span className={`text-[8px] max-w-[60px] truncate text-center leading-tight ${
                  isSelected ? "text-primary font-semibold" : "text-muted-foreground/60"
                }`}>
                  {org.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Close */}
        <div className="py-3">
          <button onClick={closePanel} className="text-muted-foreground/60 hover:text-foreground transition-colors" title="Fechar" aria-label="Fechar painel">
            <X className="size-4" />
          </button>
        </div>
      </aside>

      {/* Confirmation Modal - "Alterar entre contas?" */}
      {confirmOrg && (
        <ConfirmSwitchModal
          org={confirmOrg}
          onConfirm={async () => {
            const result = await switchAdminContext(confirmOrg.id);
            if (!result.success) {
              toast.error(result.error || "Erro ao trocar contexto");
              setConfirmOrg(null);
              return;
            }
            setClient(confirmOrg.id, confirmOrg.name);
            setConfirmOrg(null);
            // Force Zustand persist flush to localStorage before reload
            const current = JSON.parse(localStorage.getItem("admin-selected-client") || "{}");
            current.state = { ...current.state, selectedClientId: confirmOrg.id, selectedClientName: confirmOrg.name };
            localStorage.setItem("admin-selected-client", JSON.stringify(current));
            // Full page reload so server layout re-reads the cookie and renders ClientShell
            window.location.href = "/";
          }}
          onCancel={() => setConfirmOrg(null)}
        />
      )}

      {/* Search Modal */}
      {showSearch && (
        <SearchClientsModal
          orgs={orgs}
          onSelect={(org) => {
            setShowSearch(false);
            setConfirmOrg(org);
          }}
          onEdit={(org) => {
            setShowSearch(false);
            setEditingOrg(org);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Edit Modal */}
      {editingOrg && (
        <EditClientModal
          org={editingOrg}
          onSaved={() => {
            setEditingOrg(null);
            refreshOrgs();
          }}
          onClose={() => setEditingOrg(null)}
        />
      )}
    </>
  );
}

// ============ CONFIRM SWITCH MODAL ============

function ConfirmSwitchModal({ org, onConfirm, onCancel }: { org: Org; onConfirm: () => void; onCancel: () => void }) {
  const focusTrapRef = useFocusTrap(true);
  useEscapeKey(true, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="confirm-switch-title" className="relative bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 id="confirm-switch-title" className="text-base font-semibold text-foreground">Alterar entre contas?</h2>
          <button onClick={onCancel} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Ao confirmar você está mudando de conta para a do usuário abaixo:
        </p>

        <div className="bg-muted border border-border rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className={`size-12 rounded-full flex items-center justify-center text-white text-sm font-bold ${hashColor(org.name)}`}>
              {getInitials(org.name)}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{org.name}</p>
              <p className="text-xs text-muted-foreground">{org.category || "empresa"} • {org.plan}</p>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-2">Conexoes</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground">WhatsApp</span>
            <span className="text-emerald-400 text-xs">Conectado ✓</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground/60 mb-4">
          Você pode retornar à sua conta clicando em retornar na parte superior!
        </p>

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm border border-border rounded-xl text-muted-foreground hover:text-foreground hover:border-muted-foreground/30">
            Cancelar
          </button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium">
            Acessar conta
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ SEARCH CLIENTS MODAL ============

function SearchClientsModal({ orgs, onSelect, onEdit, onClose }: {
  orgs: Org[];
  onSelect: (org: Org) => void;
  onEdit: (org: Org) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const focusTrapRef = useFocusTrap(true);
  useEscapeKey(true, onClose);

  const filtered = orgs.filter((o) =>
    o.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="search-clients-title" className="relative bg-background border border-border rounded-2xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-2">
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <h2 id="search-clients-title" className="text-center text-lg font-semibold text-foreground px-5">
          Pesquisar uma conta em sua lista
        </h2>

        {/* Search */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs text-muted-foreground text-center mb-3">Nome do Cliente</p>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-4 py-2.5 text-sm bg-muted border-2 border-[#2E6ECE] rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-[#4A9AFF]"
            autoFocus
          />
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto px-5 pb-5 pt-3 space-y-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground/60 text-center py-6">Nenhum cliente encontrado</p>
          ) : (
            filtered.map((org) => (
              <div
                key={org.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border hover:border-muted-foreground/30 transition-colors"
              >
                {/* Avatar */}
                <button
                  onClick={() => onSelect(org)}
                  className={`size-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 cursor-pointer hover:ring-2 hover:ring-primary transition-all ${hashColor(org.name)}`}
                >
                  {getInitials(org.name)}
                </button>

                {/* Info */}
                <button onClick={() => onSelect(org)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-foreground">{org.name}</p>
                  <p className="text-xs text-muted-foreground">{org.category || "empresa"}</p>
                </button>

                {/* Action buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onEdit(org)}
                    className="size-8 flex items-center justify-center text-emerald-400 hover:text-emerald-300 transition-colors"
                    title="Editar"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Excluir ${org.name}?`)) {
                        toast.error("Use a pagina de Clientes para excluir");
                      }
                    }}
                    className="size-8 flex items-center justify-center text-red-400 hover:text-red-300 transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============ EDIT CLIENT MODAL ============

function EditClientModal({ org, onSaved, onClose }: { org: Org; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(org.name);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const focusTrapRef = useFocusTrap(true);
  useEscapeKey(true, onClose);
  const [services, setServices] = useState<Record<string, boolean>>(
    org.services || {
      chat: true, crm: true, leads: true, groups: true,
      automations: true, campaigns: false, reports: true,
    }
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const serviceLabels: Record<string, string> = {
    chat: "Assistente Virtual",
    campaigns: "Disparo em Massa",
    automations: "Fluxo de Automação",
    leads: "Landing Page",
    crm: "CRM",
    groups: "Grupos WhatsApp",
    reports: "Relatórios",
  };

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = () => setLogoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      let logoUrl: string | undefined;

      // Upload logo to Supabase Storage
      if (logoFile) {
        const supabase = getSupabaseBrowserClient();
        const ext = logoFile.name.split(".").pop() || "png";
        const path = `logos/${org.id}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("organizations")
          .upload(path, logoFile, { upsert: true, contentType: logoFile.type });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from("organizations").getPublicUrl(path);
          logoUrl = urlData.publicUrl;
        }
      }

      await updateOrganization(org.id, {
        name,
        services,
        ...(logoUrl ? { logo_url: logoUrl } : {}),
      });
      toast.success("Conta atualizada");
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="edit-client-title" className="relative bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 id="edit-client-title" className="text-base font-semibold text-foreground">Editar conta</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
        </div>

        <div className="space-y-4">
          {/* Logo */}
          <div>
            <label className="text-xs text-muted-foreground block mb-2">Logo</label>
            <div className="flex items-center gap-3">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="size-12 rounded-full object-cover border border-border" />
              ) : (
                <div className={`size-12 rounded-full flex items-center justify-center text-white text-sm font-bold ${hashColor(org.name)}`}>
                  {getInitials(org.name)}
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
              >
                Escolher arquivo
              </button>
              <span className="text-xs text-muted-foreground/60">{logoPreview ? "Arquivo selecionado" : "Nenhum arquivo escolhido"}</span>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary"
            />
          </div>

          {/* Password */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Senha</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Deixe vazio para manter"
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary"
            />
          </div>

          {/* Services */}
          <div>
            <label className="text-xs text-muted-foreground block mb-2">Servicos</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(serviceLabels).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={services[key] ?? false}
                      onChange={(e) => setServices({ ...services, [key]: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-muted rounded-full peer-checked:bg-blue-500 transition-colors" />
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-4 transition-transform" />
                  </div>
                  <span className="text-xs text-foreground">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-xl text-muted-foreground hover:text-foreground">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="size-4 animate-spin" />} Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
