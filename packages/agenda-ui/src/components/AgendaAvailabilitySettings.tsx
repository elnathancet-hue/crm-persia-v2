"use client";

import * as React from "react";
import { CalendarOff, Loader2, Plus } from "lucide-react";
import { Button } from "@persia/ui/button";
import {
  type AvailabilityDay,
  type AvailabilityRule,
  type DayOfWeek,
} from "@persia/shared/agenda";
import { useAgendaCallbacks } from "../context";
import { useAvailability } from "../hooks/useAvailability";
import { WeeklyAvailabilityEditor } from "./WeeklyAvailabilityEditor";

const DEFAULT_DAYS: AvailabilityDay[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  day_of_week: d as DayOfWeek,
  enabled: d >= 1 && d <= 5,
  intervals: d >= 1 && d <= 5 ? [{ start: "09:00", end: "18:00" }] : [],
}));

/** Tab "Disponibilidade" — lista regras + editor da regra selecionada. */
export const AgendaAvailabilitySettings: React.FC = () => {
  const { currentUserId } = useAgendaCallbacks();

  const { rules, loading, error, refresh, create, update } = useAvailability(
    // Sem filtro: o backend ja restringe agent ao proprio user_id.
    {},
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  // Auto-seleciona a primeira regra ou marca pra criar nova
  React.useEffect(() => {
    if (loading) return;
    if (rules.length === 0) {
      setSelectedId(null);
      setCreating(true);
    } else if (!selectedId || !rules.find((r) => r.id === selectedId)) {
      const def = rules.find((r) => r.is_default) ?? rules[0]!;
      setSelectedId(def.id);
      setCreating(false);
    }
  }, [loading, rules, selectedId]);

  const handleCreateNew = () => {
    setSelectedId(null);
    setCreating(true);
  };

  const handleSaveNew = async (patch: {
    name?: string;
    timezone?: string;
    default_duration_minutes?: number;
    days?: AvailabilityDay[];
    is_default?: boolean;
  }) => {
    if (!currentUserId) {
      throw new Error("Usuário não identificado — recarregue a página");
    }
    const created = await create({
      user_id: currentUserId,
      name: patch.name,
      timezone: patch.timezone,
      default_duration_minutes: patch.default_duration_minutes,
      days: patch.days,
      is_default: patch.is_default,
    });
    setCreating(false);
    setSelectedId(created.id);
    await refresh();
  };

  const handleSaveExisting = async (patch: Parameters<typeof update>[1]) => {
    if (!selectedId) return;
    await update(selectedId, patch);
    await refresh();
  };

  const selected = selectedId ? rules.find((r) => r.id === selectedId) : null;

  // PR-AGENDA-DS Fase 2 (mai/2026): rounded-3xl/ring-1 → rounded-xl/border.
  if (loading && rules.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 p-12 text-muted-foreground/70">
        <Loader2 className="mr-2 size-5 animate-spin" /> Carregando...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
        {error}
      </div>
    );
  }

  // Estado: criando primeira regra (org sem nada cadastrado)
  if (creating) {
    const fakeRule: AvailabilityRule = {
      id: "new",
      organization_id: "",
      user_id: currentUserId ?? "",
      name: "Padrão",
      timezone: "America/Sao_Paulo",
      default_duration_minutes: 60,
      days: DEFAULT_DAYS,
      is_default: rules.length === 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return (
      <div className="space-y-6">
        {rules.length > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-muted p-3 text-xs">
            <span className="font-semibold text-foreground">
              Criando nova regra
            </span>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                if (rules[0]) setSelectedId(rules[0].id);
              }}
              className="font-bold text-primary hover:underline"
            >
              Cancelar
            </button>
          </div>
        )}
        <WeeklyAvailabilityEditor rule={fakeRule} onSave={handleSaveNew} />
      </div>
    );
  }

  // Sem regras e sem currentUserId → mostra placeholder
  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/40 p-12 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-card text-muted-foreground/70 shadow-xs">
          <CalendarOff className="size-5" />
        </div>
        <p className="mt-4 text-sm font-semibold text-foreground">
          Nenhuma regra de disponibilidade
        </p>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleCreateNew}
          className="mt-4"
        >
          <Plus className="size-3.5" data-icon="inline-start" />
          Criar regra padrão
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {rules.map((r) => {
            const isActive = r.id === selectedId;
            return (
              <Button
                key={r.id}
                type="button"
                variant={isActive ? "default" : "secondary"}
                size="sm"
                onClick={() => {
                  setSelectedId(r.id);
                  setCreating(false);
                }}
              >
                {r.name}
                {r.is_default && (
                  <span className="ml-1 rounded-full bg-success px-1.5 py-0.5 text-[9px] font-bold text-success-foreground">
                    PADRÃO
                  </span>
                )}
              </Button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCreateNew}
        >
          <Plus className="size-3.5" data-icon="inline-start" />
          Nova regra
        </Button>
      </div>

      {selected && (
        <WeeklyAvailabilityEditor
          key={selected.id}
          rule={selected}
          onSave={handleSaveExisting}
        />
      )}
    </div>
  );
};
