"use client";

// MarkAsLostDialog (PR-K3) — captura motivo de perda + concorrente +
// nota de aprendizado. Usado tanto pra perda individual (1 deal) quanto
// pra perda em massa (N deals) — controlado pelo prop `count`.
//
// Tema PersiaCRM: semantic tokens (light + dark), shadcn primitives.

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { DealLossReason } from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "./DialogHero";

export interface MarkAsLostFormValues {
  loss_reason: string;
  competitor: string;
  loss_note: string;
}

interface MarkAsLostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quantos deals serao marcados (>=1). Plural automatico no titulo. */
  count: number;
  /** Lista de motivos cadastrados. Vazio = mostra so input livre. */
  reasons: DealLossReason[];
  /** Carrega reasons sob demanda quando abrir (lazy). */
  onLoadReasons?: () => void;
  /** Callback do submit. Throw fora pra mostrar toast. */
  onConfirm: (input: MarkAsLostFormValues) => Promise<void>;
  pending: boolean;
  /** Titulo do deal pra mostrar no header (so quando count=1). */
  dealTitle?: string | null;
}

const FALLBACK_FREE_REASON = "__free__";

export function MarkAsLostDialog({
  open,
  onOpenChange,
  count,
  reasons,
  onLoadReasons,
  onConfirm,
  pending,
  dealTitle,
}: MarkAsLostDialogProps) {
  const [picked, setPicked] = React.useState<string>("");
  const [freeReason, setFreeReason] = React.useState<string>("");
  const [competitor, setCompetitor] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");

  // Lazy load + reset on open
  React.useEffect(() => {
    if (open) {
      onLoadReasons?.();
      setPicked("");
      setFreeReason("");
      setCompetitor("");
      setNote("");
    }
  }, [open, onLoadReasons]);

  // Default seleciona o primeiro reason quando lista carrega
  React.useEffect(() => {
    if (open && reasons.length > 0 && !picked) {
      setPicked(reasons[0].label);
    }
  }, [open, reasons, picked]);

  const selectedReason = React.useMemo(
    () => reasons.find((r) => r.label === picked) ?? null,
    [reasons, picked],
  );

  const requiresCompetitor = selectedReason?.requires_competitor ?? false;
  const isFreeForm = picked === FALLBACK_FREE_REASON;

  const finalReason = isFreeForm ? freeReason.trim() : picked.trim();
  const canSubmit = finalReason.length > 0 && !pending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onConfirm({
      loss_reason: finalReason,
      competitor: requiresCompetitor || competitor.trim() ? competitor.trim() : "",
      loss_note: note.trim(),
    });
  };

  const dialogTitle =
    count === 1
      ? "Marcar como perdido"
      : `Marcar ${count} negócios como perdidos`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl w-[92vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          {/* DialogTitle invisivel pra a11y do Radix; o titulo visivel
              vem do DialogHero. */}
          <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
          <DialogHero
            icon={<AlertTriangle className="size-5" />}
            title={dialogTitle}
            tagline={
              count === 1 && dealTitle
                ? `"${dealTitle}"`
                : "Registre o motivo pra alimentar relatórios"
            }
            tone="destructive"
          />
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Motivo principal — chips */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Motivo principal
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {reasons.map((r) => {
                const active = picked === r.label;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setPicked(r.label);
                      // Reset competitor se o novo motivo nao requer
                      if (!r.requires_competitor) setCompetitor("");
                    }}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-destructive bg-destructive text-destructive-foreground"
                        : "border-border bg-muted text-foreground hover:bg-muted/70"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setPicked(FALLBACK_FREE_REASON)}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  isFreeForm
                    ? "border-destructive bg-destructive text-destructive-foreground"
                    : "border-dashed border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                + Outro motivo
              </button>
            </div>
            {isFreeForm && (
              <Input
                autoFocus
                value={freeReason}
                onChange={(e) => setFreeReason(e.target.value)}
                placeholder="Descreva o motivo..."
                className="h-9"
              />
            )}
          </div>

          {/* Concorrente — aparece quando o motivo pede OU sempre opcional */}
          {(requiresCompetitor || competitor.length > 0 || isFreeForm) && (
            <div className="space-y-2">
              <Label htmlFor="competitor" className="text-xs">
                Qual concorrente?{" "}
                {!requiresCompetitor && (
                  <span className="text-muted-foreground">(opcional)</span>
                )}
              </Label>
              <Input
                id="competitor"
                value={competitor}
                onChange={(e) => setCompetitor(e.target.value)}
                placeholder="Ex: Nome da empresa"
                className="h-9"
              />
            </div>
          )}

          {/* Nota de aprendizado */}
          <div className="space-y-2">
            <Label htmlFor="loss-note" className="text-xs">
              Notas de aprendizado{" "}
              <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="loss-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="O que aconteceu? Detalhe pra revisar depois..."
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {pending ? "Marcando..." : "Confirmar perda"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
