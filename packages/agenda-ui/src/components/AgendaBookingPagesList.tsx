"use client";

import * as React from "react";
import { Link as LinkIcon, Loader2, Plus } from "lucide-react";
import type { AgendaService, BookingPage } from "@persia/shared/agenda";
import { useBookingPages } from "../hooks/useBookingPages";
import { BookingPageCard } from "./BookingPageCard";
import { BookingPageDrawer } from "./BookingPageDrawer";

interface AgendaBookingPagesListProps {
  /** Slug da org pra montar URLs. Vem da page server. */
  orgSlug: string;
  /** Servicos disponiveis pra filhar de duracao no form. */
  services: readonly AgendaService[];
  /** Origin opcional (default: window.location.origin no client). */
  origin?: string;
}

/** Tab "Páginas de agendamento" — grid de cards + drawer create/edit. */
export const AgendaBookingPagesList: React.FC<AgendaBookingPagesListProps> = ({
  orgSlug,
  services,
  origin,
}) => {
  const { pages, loading, error, refresh, duplicate, remove } = useBookingPages();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BookingPage | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const handleNew = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const handleEdit = (page: BookingPage) => {
    setEditing(page);
    setDrawerOpen(true);
  };

  const handleDuplicate = async (page: BookingPage) => {
    setActionError(null);
    try {
      // Slug "-copia" sufixo, com unique check do server
      const baseSlug = page.slug;
      let attempt = `${baseSlug}-copia`;
      // Tenta ate 3 vezes adicionando sufixos numericos
      for (let i = 0; i < 4; i++) {
        try {
          await duplicate(page.id, attempt);
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (msg.includes("ja esta em uso") || msg.includes("já está em uso")) {
            attempt = `${baseSlug}-copia-${i + 2}`;
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao duplicar");
    }
  };

  const handleDelete = async (page: BookingPage) => {
    if (!confirm(`Excluir "${page.title}"? Os agendamentos existentes não são afetados.`)) {
      return;
    }
    setActionError(null);
    try {
      await remove(page.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao excluir");
    }
  };

  if (loading && pages.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-12 text-slate-400">
        <Loader2 size={20} className="mr-2 animate-spin" /> Carregando...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl bg-rose-50 p-5 text-sm text-rose-700 ring-1 ring-rose-200">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
            {pages.length} {pages.length === 1 ? "página" : "páginas"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleNew}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700"
        >
          <Plus size={14} />
          Nova página
        </button>
      </div>

      {actionError && (
        <div className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
          {actionError}
        </div>
      )}

      {pages.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
            <LinkIcon size={20} />
          </div>
          <p className="mt-4 text-xs font-bold uppercase tracking-widest text-slate-500">
            Sem páginas de agendamento
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Crie um link público pra leads agendarem sozinhos
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pages.map((page) => (
            <BookingPageCard
              key={page.id}
              page={page}
              orgSlug={orgSlug}
              origin={origin}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <BookingPageDrawer
        open={drawerOpen}
        existing={editing}
        services={services}
        orgSlug={orgSlug}
        origin={origin}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => refresh()}
      />
    </div>
  );
};
