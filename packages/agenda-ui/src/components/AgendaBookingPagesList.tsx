"use client";

import * as React from "react";
import { Link as LinkIcon, Loader2, Plus } from "lucide-react";
import type { AgendaService, BookingPage } from "@persia/shared/agenda";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@persia/ui/alert-dialog";
import { Button } from "@persia/ui/button";
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
  const { pages, loading, error, refresh, duplicate, remove } =
    useBookingPages();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BookingPage | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<BookingPage | null>(
    null,
  );

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
      const baseSlug = page.slug;
      let attempt = `${baseSlug}-copia`;
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

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setActionError(null);
    try {
      await remove(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao excluir");
      setDeleteTarget(null);
    }
  };

  if (loading && pages.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed bg-muted/40 p-12 text-muted-foreground">
        <Loader2 size={20} className="mr-2 animate-spin" /> Carregando...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive ring-1 ring-destructive/30">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {pages.length} {pages.length === 1 ? "página" : "páginas"}
        </p>
        <Button type="button" onClick={handleNew}>
          <Plus />
          Nova página
        </Button>
      </div>

      {actionError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/30">
          {actionError}
        </div>
      )}

      {pages.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-card text-muted-foreground shadow-sm">
            <LinkIcon size={20} />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">
            Sem páginas de agendamento
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
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
              onDelete={(p) => setDeleteTarget(p)}
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir página de agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget &&
                `"${deleteTarget.title}" será removida permanentemente. Os agendamentos existentes não são afetados.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
