"use client";

import * as React from "react";
import { Bell, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { AgendaReminderConfig } from "@persia/shared/agenda";
import {
  ReminderConfigDrawer,
  type ExistingPayload,
} from "./ReminderConfigDrawer";

export interface AgendaSettingsActions {
  list: () => Promise<AgendaReminderConfig[]>;
  create: (input: ExistingPayload) => Promise<AgendaReminderConfig>;
  update: (id: string, input: ExistingPayload) => Promise<AgendaReminderConfig>;
  remove: (id: string) => Promise<void>;
  seedDefaults: () => Promise<AgendaReminderConfig[]>;
}

interface AgendaSettingsTabProps {
  actions: AgendaSettingsActions;
}

function offsetLabel(min: number): string {
  if (min < 60) return `${min} min antes`;
  if (min < 1440) {
    const h = min / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)}h antes`;
  }
  const d = min / 1440;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} dia${d === 1 ? "" : "s"} antes`;
}

/** Tab "Ajustes" — por enquanto so Lembretes WhatsApp. */
export const AgendaSettingsTab: React.FC<AgendaSettingsTabProps> = ({
  actions,
}) => {
  const [items, setItems] = React.useState<AgendaReminderConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AgendaReminderConfig | null>(
    null,
  );
  const [seeding, setSeeding] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await actions.list();
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [actions]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const handleEdit = (cfg: AgendaReminderConfig) => {
    setEditing(cfg);
    setDrawerOpen(true);
  };
  const handleDelete = async (cfg: AgendaReminderConfig) => {
    if (!confirm(`Excluir "${cfg.name}"? Lembretes pendentes não são afetados.`)) return;
    try {
      await actions.remove(cfg.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };
  const handleSave = async (input: ExistingPayload) => {
    if (editing) {
      await actions.update(editing.id, input);
    } else {
      await actions.create(input);
    }
    await refresh();
  };
  const handleSeed = async () => {
    setSeeding(true);
    try {
      await actions.seedDefaults();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar defaults");
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-black text-slate-900">
          Lembretes WhatsApp
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Mensagens automáticas enviadas pelo WhatsApp da sua organização. Pode
          enviar confirmação imediata + N lembretes antes do compromisso.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-slate-400">
          <Loader2 size={18} className="mr-2 animate-spin" /> Carregando...
        </div>
      ) : error ? (
        <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="space-y-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
            <Bell size={20} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-700">
              Nenhum lembrete configurado
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Aplique os defaults (24h + 1h antes + confirmação imediata) ou crie do zero
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleSeed}
              disabled={seeding}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {seeding ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              Aplicar defaults
            </button>
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-100"
            >
              <Plus size={12} />
              Criar do zero
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700"
            >
              <Plus size={14} />
              Novo lembrete
            </button>
          </div>

          <ul className="space-y-3">
            {items.map((cfg) => (
              <li
                key={cfg.id}
                className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Bell
                        size={14}
                        className={
                          cfg.is_active ? "text-indigo-600" : "text-slate-300"
                        }
                      />
                      <h3 className="truncate text-sm font-bold text-slate-900">
                        {cfg.name}
                      </h3>
                      {!cfg.is_active && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                          Inativo
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                      {cfg.trigger_when === "on_create"
                        ? "Imediato (ao agendar)"
                        : offsetLabel(cfg.trigger_offset_minutes)}
                      {" · "}
                      WhatsApp
                    </p>
                    <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-slate-700">
                      {cfg.template_text}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleEdit(cfg)}
                      className="rounded-lg p-2 text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-600"
                      aria-label="Editar"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(cfg)}
                      className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Excluir"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ReminderConfigDrawer
        open={drawerOpen}
        existing={editing}
        onClose={() => setDrawerOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
};
