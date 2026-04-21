"use client";

import { useEffect, useState, useRef } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getLeads, createLead, deleteLead, type LeadWithTags } from "@/actions/leads";
import { getTags } from "@/actions/tags";
import { LeadDetail } from "@/components/leads/lead-detail";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { Search, Plus, Contact, Trash2, X, Loader2 } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Novo", color: "bg-blue-500" },
  contacted: { label: "Contatado", color: "bg-amber-500" },
  qualified: { label: "Qualificado", color: "bg-purple-500" },
  customer: { label: "Cliente", color: "bg-emerald-500" },
  lost: { label: "Perdido", color: "bg-red-500" },
};

export function LeadListPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [leads, setLeads] = useState<LeadWithTags[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [tags, setTags] = useState<any[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    getLeads({
      search: search || undefined,
      status: statusFilter || undefined,
      tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      page,
    }).then(({ data, count }) => {
      setLeads(data || []);
      setTotalCount(count || 0);
      setLoading(false);
    });
  }, [activeOrgId, search, selectedTagIds, statusFilter, page]);

  useEffect(() => {
    getTags().then(setTags).catch(() => {});
  }, []);

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handleTagToggle(tagId: string) {
    setPage(1);
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  if (selectedLeadId) {
    return <LeadDetail leadId={selectedLeadId} onBack={() => setSelectedLeadId(null)} />;
  }

  const totalPages = Math.ceil(totalCount / 20);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground">{totalCount} leads encontrados</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm font-medium transition-colors"
        >
          <Plus className="size-4" /> Novo Lead
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="Buscar por nome, email ou telefone..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm bg-card border border-border rounded-lg text-foreground outline-none"
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {tags.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {tags.map((tag) => {
            const active = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleTagToggle(tag.id)}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active ? "border-transparent" : "border-border hover:bg-muted"
                }`}
                style={
                  active
                    ? {
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }
                    : undefined
                }
              >
                {tag.name}
              </button>
            );
          })}
          {selectedTagIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedTagIds([]);
                setPage(1);
              }}
              className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Limpar tags
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Contact className="size-10 mb-2 text-muted-foreground/30" />
          <p>Nenhum lead encontrado</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Telefone</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Email</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Tags</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Criado em</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const st = STATUS_LABELS[lead.status] || { label: lead.status, color: "bg-gray-500" };
                return (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className="border-b border-accent hover:bg-muted cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm text-foreground font-medium">{lead.name || "Sem nome"}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm text-muted-foreground">{lead.phone || "—"}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-sm text-muted-foreground">{lead.email || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full text-white ${st.color}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex gap-1 flex-wrap">
                        {lead.lead_tags?.slice(0, 3).map((lt) => (
                          <span
                            key={lt.tag_id}
                            className="text-[10px] px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: lt.tags.color + "30", color: lt.tags.color }}
                          >
                            {lt.tags.name}
                          </span>
                        ))}
                        {lead.lead_tags?.length > 3 && (
                          <span className="text-[10px] text-muted-foreground/60">+{lead.lead_tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground/60">
                        {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        aria-label="Excluir"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Excluir este lead?")) {
                            deleteLead(lead.id).then(({ error }) => {
                              if (error) toast.error(error);
                              else {
                                setLeads(prev => prev.filter(l => l.id !== lead.id));
                                toast.success("Lead excluido");
                              }
                            });
                          }
                        }}
                        className="text-muted-foreground/60 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 text-sm bg-card border border-border rounded-lg text-muted-foreground disabled:opacity-50 hover:text-foreground"
          >
            Anterior
          </button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 text-sm bg-card border border-border rounded-lg text-muted-foreground disabled:opacity-50 hover:text-foreground"
          >
            Proximo
          </button>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateLeadModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setPage(1);
            getLeads({ page: 1 }).then(({ data, count }) => {
              setLeads(data || []);
              setTotalCount(count || 0);
            });
          }}
        />
      )}
    </div>
  );
}

function CreateLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const focusTrapRef = useFocusTrap(true);
  useEscapeKey(true, onClose);

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let valid = true; const newErrors: Record<string, string> = {};
    if (!name.trim()) { newErrors.name = "Campo obrigatório"; valid = false; }
    if (!phone.trim() && !email.trim()) { newErrors.contact = "Informe pelo menos telefone ou email"; valid = false; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { newErrors.email = "Email inválido"; valid = false; }
    if (!valid) { setErrors(newErrors); return; }
    setSaving(true);
    const { error } = await createLead({ name, phone, email });
    if (error) toast.error(error);
    else {
      toast.success("Lead criado");
      onCreated();
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="create-lead-title" className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 id="create-lead-title" className="text-lg font-semibold text-foreground">Novo Lead</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Nome *</label>
            <input value={name} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }} onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.name ? "border-red-500" : "border-border"}`} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Telefone</label>
            <input value={phone} onChange={(e) => { setPhone(e.target.value); clearFieldError("contact"); }} className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.contact ? "border-red-500" : "border-border"}`} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Email</label>
            <input value={email} onChange={(e) => { setEmail(e.target.value); clearFieldError("contact"); clearFieldError("email"); }} onBlur={() => { if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) setFieldError("email", "Email inválido"); }} type="email" className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.email || errors.contact ? "border-red-500" : "border-border"}`} />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
            {errors.contact && <p className="text-xs text-red-500 mt-1">{errors.contact}</p>}
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />} Criar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
