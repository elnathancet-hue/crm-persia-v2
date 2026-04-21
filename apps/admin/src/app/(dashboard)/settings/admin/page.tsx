"use client";

import { useEffect, useState } from "react";
import { getSuperadmins, addSuperadmin, removeSuperadmin } from "@/actions/settings";
import { getAdminStats } from "@/actions/admin";
import { ShieldCheck, Loader2, Users, MessageSquare, Contact, Bot, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export default function AdminPage() {
  const [superadmins, setSuperadmins] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);

  function load() {
    Promise.all([getSuperadmins(), getAdminStats()]).then(([admins, s]) => {
      setSuperadmins(admins);
      setStats(s);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addEmail.trim()) return;
    setAdding(true);
    const { error } = await addSuperadmin(addEmail.trim());
    if (error) toast.error(error);
    else {
      toast.success("Superadmin adicionado");
      setAddEmail("");
      setShowAdd(false);
      load();
    }
    setAdding(false);
  }

  async function handleRemove(userId: string, name: string) {
    if (!confirm(`Remover ${name} como superadmin?`)) return;
    const { error } = await removeSuperadmin(userId);
    if (error) toast.error(error);
    else { toast.success("Superadmin removido"); load(); }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>;

  const statCards = [
    { label: "Organizações", value: stats?.organizations || 0, icon: Users, color: "text-blue-400" },
    { label: "Leads", value: stats?.leads || 0, icon: Contact, color: "text-emerald-400" },
    { label: "Conversas", value: stats?.conversations || 0, icon: MessageSquare, color: "text-purple-400" },
    { label: "Assistentes IA", value: stats?.assistants || 0, icon: Bot, color: "text-amber-400" },
  ];

  return (
    <div className="space-y-6">
      {/* Global Stats */}
      <div>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">Estatisticas Globais</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`size-4 ${s.color}`} />
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{s.value.toLocaleString("pt-BR")}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Superadmins */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Superadmins</h2>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/80 text-white rounded-xl text-xs">
            <Plus className="size-3" /> Adicionar
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <form onSubmit={handleAdd} className="mb-3 flex items-center gap-2 bg-card border border-border rounded-xl p-3">
            <input
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              type="email"
              placeholder="Email do usuario existente..."
              className="flex-1 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary"
              autoFocus
              required
            />
            <button type="submit" disabled={adding} className="px-3 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg text-xs disabled:opacity-50 flex items-center gap-1">
              {adding && <Loader2 className="size-3 animate-spin" />} Adicionar
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setAddEmail(""); }} className="text-muted-foreground/60 hover:text-foreground p-1">
              <X className="size-4" />
            </button>
          </form>
        )}

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Telefone</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {superadmins.map((a) => (
                <tr key={a.id} className="border-b border-accent">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-4 text-primary" />
                      <span className="text-sm text-foreground">{a.full_name || "Sem nome"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{a.email}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{a.phone || "—"}</td>
                  <td className="px-4 py-3">
                    {superadmins.length > 1 && (
                      <button onClick={() => handleRemove(a.id, a.full_name || a.email)} className="text-muted-foreground/60 hover:text-primary p-1" title="Remover superadmin">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-2">O usuario precisa existir no Supabase Auth para ser adicionado como superadmin.</p>
      </div>
    </div>
  );
}
