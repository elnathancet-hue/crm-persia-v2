"use client";

import * as React from "react";
import { Bell, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { AgendaReminderConfig } from "@persia/shared/agenda";
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
  const [deleteTarget, setDeleteTarget] =
    React.useState<AgendaReminderConfig | null>(null);
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
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await actions.remove(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir");
      setDeleteTarget(null);
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

  // PR-AGENDA-DS Fase 2 (mai/2026): tokens DS + Button primitivo.
  // Antes: HTML buttons com font-black uppercase tracking-widest + rounded-2xl/3xl + text-white hardcoded.
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          Lembretes WhatsApp
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Mensagens automáticas enviadas pelo WhatsApp da sua organização. Pode
          enviar confirmação imediata + N lembretes antes do compromisso.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 p-10 text-muted-foreground/70">
          <Loader2 className="mr-2 size-4 animate-spin" /> Carregando...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="space-y-4 rounded-xl border border-dashed border-border bg-muted/40 p-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-card text-muted-foreground/70 shadow-xs">
            <Bell className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Nenhum lembrete configurado
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Aplique os defaults (24h + 1h antes + confirmação imediata) ou crie do zero.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleSeed}
              disabled={seeding}
            >
              {seeding ? (
                <Loader2 className="size-3.5 animate-spin" data-icon="inline-start" />
              ) : (
                <Sparkles className="size-3.5" data-icon="inline-start" />
              )}
              Aplicar defaults
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCreate}
            >
              <Plus className="size-3.5" data-icon="inline-start" />
              Criar do zero
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleCreate}
            >
              <Plus className="size-4" data-icon="inline-start" />
              Novo lembrete
            </Button>
          </div>

          <ul className="space-y-3">
            {items.map((cfg) => (
              <li
                key={cfg.id}
                className="rounded-xl border border-border bg-card p-4 shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Bell
                        className={`size-3.5 ${
                          cfg.is_active ? "text-primary" : "text-muted-foreground/40"
                        }`}
                      />
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {cfg.name}
                      </h3>
                      {!cfg.is_active && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Inativo
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      {cfg.trigger_when === "on_create"
                        ? "Imediato (ao agendar)"
                        : offsetLabel(cfg.trigger_offset_minutes)}
                      {" · "}
                      WhatsApp
                    </p>
                    <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-foreground">
                      {cfg.template_text}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleEdit(cfg)}
                      aria-label="Editar"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(cfg)}
                      aria-label="Excluir"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lembrete?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget &&
                `"${deleteTarget.name}" será removido. Lembretes pendentes não são afetados.`}
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
