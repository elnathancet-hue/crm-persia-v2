"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { useClientStore } from "@/lib/stores/client-store";
import { getTeamMembers, createTeamMember, updateMemberRole, toggleMemberActive } from "@/actions/settings";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { Users, Plus, Loader2, X } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

const ROLES = [
  { value: "owner", label: "Dono" },
  { value: "admin", label: "Admin" },
  { value: "gestor", label: "Gestor" },
  { value: "usuario", label: "Agente" },
  { value: "viewer", label: "Visualizador" },
];

function isContextError(error: string | undefined): boolean {
  if (!error) return false;
  return error.includes("Nenhum contexto ativo") ||
    error.includes("Contexto invalido") ||
    error.includes("sessao diferente");
}

export default function TeamPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const clearClient = useClientStore((s) => s.clearClient);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function handleContextExpired() {
    clearClient();
    toast.error("Contexto expirado. Selecione o cliente novamente.");
  }

  function loadMembers() {
    if (!isManagingClient) return;
    setLoading(true);
    setLoadError(null);
    getTeamMembers()
      .then((data) => {
        setMembers(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setLoading(false);
        if (isContextError(msg)) {
          handleContextExpired();
        } else {
          setLoadError(msg);
          toast.error("Erro ao carregar equipe: " + msg);
        }
      });
  }

  useEffect(() => { loadMembers(); }, [activeOrgId]);

  async function handleRoleChange(memberId: string, role: string) {
    const { error } = await updateMemberRole(memberId, role);
    if (error) {
      if (isContextError(error)) { handleContextExpired(); return; }
      toast.error(error);
    } else {
      toast.success("Role atualizado");
      loadMembers();
    }
  }

  async function handleToggle(memberId: string) {
    const { error } = await toggleMemberActive(memberId);
    if (error) {
      if (isContextError(error)) { handleContextExpired(); return; }
      toast.error(error);
    } else {
      toast.success("Status alterado");
      loadMembers();
    }
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{members.length} membros</p>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm">
          <Plus className="size-4" /> Novo Membro
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : loadError ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
          <p className="text-sm text-red-400">{loadError}</p>
          <button onClick={loadMembers} className="mt-3 text-xs text-muted-foreground hover:text-foreground">Tentar novamente</button>
        </div>
      ) : members.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Users className="size-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum membro encontrado</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Email</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Telefone</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-accent">
                  <td className="px-4 py-3 text-sm text-foreground">{m.name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{m.email}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{m.phone || "—"}</td>
                  <td className="px-4 py-3">
                    {m.role === "owner" ? (
                      <span className="text-xs text-amber-400 font-medium">Dono</span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.id, e.target.value)}
                        className="text-xs bg-muted border border-border rounded px-2 py-1 text-foreground outline-none"
                      >
                        {ROLES.filter(r => r.value !== "owner").map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${m.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                      {m.is_active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {m.role !== "owner" && (
                      <button onClick={() => handleToggle(m.id)} className="text-xs text-muted-foreground hover:text-foreground">
                        {m.is_active ? "Desativar" : "Ativar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateMemberModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadMembers(); }}
          onContextExpired={handleContextExpired}
        />
      )}
    </div>
  );
}

/** Normalize phone: keep only digits, limit to one number */
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").substring(0, 13);
}

/** Validate phone: must be 10-13 digits (BR format) or empty */
function validatePhone(phone: string): string | null {
  if (!phone) return null; // optional field
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return "Mínimo 10 dígitos (DDD + número)";
  if (digits.length > 13) return "Máximo 13 dígitos";
  // Check for multiple numbers (spaces, commas, semicolons separating numbers)
  if (/[,;\/]/.test(phone)) return "Apenas um número por campo";
  return null;
}

/** Format phone for display while typing */
function formatPhoneDisplay(digits: string): string {
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.substring(0, 2)}) ${digits.substring(2)}`;
  if (digits.length <= 11) return `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`;
  // International with country code
  return `+${digits.substring(0, 2)} (${digits.substring(2, 4)}) ${digits.substring(4, 9)}-${digits.substring(9)}`;
}

function CreateMemberModal({ onClose, onCreated, onContextExpired }: {
  onClose: () => void;
  onCreated: () => void;
  onContextExpired: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("usuario");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const focusTrapRef = useFocusTrap(true);
  useEscapeKey(true, onClose);

  function setFieldError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }
  function clearFieldError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function handlePhoneChange(raw: string) {
    const digits = normalizePhone(raw);
    setPhoneDigits(digits);
    clearFieldError("phone");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    let valid = true;

    if (!firstName.trim()) { newErrors.firstName = "Campo obrigatório"; valid = false; }
    if (!email.trim()) { newErrors.email = "Campo obrigatório"; valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { newErrors.email = "Email inválido"; valid = false; }
    if (!password) { newErrors.password = "Campo obrigatório"; valid = false; }
    else if (password.length < 6) { newErrors.password = "Mínimo 6 caracteres"; valid = false; }

    // Phone validation
    const phoneErr = validatePhone(phoneDigits);
    if (phoneErr) { newErrors.phone = phoneErr; valid = false; }

    if (!valid) { setErrors(newErrors); return; }

    setSaving(true);
    try {
      const { error } = await createTeamMember({
        firstName,
        lastName,
        email,
        phone: phoneDigits, // send only digits
        password,
        role,
      });
      if (error) {
        if (isContextError(error)) { onContextExpired(); return; }
        toast.error(error);
      } else {
        toast.success("Membro criado com sucesso");
        onCreated();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isContextError(msg)) { onContextExpired(); return; }
      toast.error("Erro ao criar membro: " + msg);
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="create-member-title" className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 id="create-member-title" className="text-lg font-semibold text-foreground">Novo Membro</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
              <input
                value={firstName}
                onChange={(e) => { setFirstName(e.target.value); clearFieldError("firstName"); }}
                className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.firstName ? "border-red-500" : "border-border"}`}
              />
              {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Sobrenome</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Email *</label>
            <input
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearFieldError("email"); }}
              onBlur={() => {
                if (!email.trim()) setFieldError("email", "Campo obrigatório");
                else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) setFieldError("email", "Email inválido");
              }}
              type="email"
              className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.email ? "border-red-500" : "border-border"}`}
            />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Telefone</label>
            <input
              value={phoneDigits ? formatPhoneDisplay(phoneDigits) : ""}
              onChange={(e) => handlePhoneChange(e.target.value)}
              onBlur={() => {
                const err = validatePhone(phoneDigits);
                if (err) setFieldError("phone", err);
              }}
              placeholder="(11) 99999-9999"
              inputMode="tel"
              className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.phone ? "border-red-500" : "border-border"}`}
            />
            {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
            <p className="text-xs text-muted-foreground/50 mt-1">Apenas um número. Somente dígitos.</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Senha *</label>
            <input
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearFieldError("password"); }}
              onBlur={() => {
                if (!password) setFieldError("password", "Campo obrigatório");
                else if (password.length < 6) setFieldError("password", "Mínimo 6 caracteres");
              }}
              type="password"
              className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.password ? "border-red-500" : "border-border"}`}
              minLength={6}
            />
            {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none">
              {ROLES.filter(r => r.value !== "owner").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />} Criar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
