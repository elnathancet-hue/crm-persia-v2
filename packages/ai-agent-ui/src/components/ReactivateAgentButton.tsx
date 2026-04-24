"use client";

import * as React from "react";
import { Bot, Loader2 } from "lucide-react";
import { Button } from "@persia/ui/button";
import { toast } from "sonner";

interface Props {
  pausedAt?: string | null;
  reason?: string | null;
  pausedConversationCount?: number;
  onReactivate: () => Promise<{ updatedCount?: number } | void>;
  onSuccess?: () => void | Promise<void>;
  className?: string;
}

function formatPausedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR");
}

export function ReactivateAgentButton({
  pausedAt,
  reason,
  pausedConversationCount,
  onReactivate,
  onSuccess,
  className,
}: Props) {
  const [isPending, startTransition] = React.useTransition();
  const pausedLabel = formatPausedAt(pausedAt);

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await onReactivate();
        const updatedCount = result?.updatedCount ?? 0;

        if (updatedCount <= 0) {
          toast.info("O bot já estava ativo para este lead.");
          return;
        }

        toast.success(
          updatedCount === 1
            ? "Bot reativado com sucesso."
            : `Bot reativado em ${updatedCount} conversas.`,
        );
        await onSuccess?.();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "Não foi possível reativar o bot.",
        );
      }
    });
  }

  return (
    <div className={className}>
      <Button variant="outline" onClick={handleClick} disabled={isPending}>
        {isPending ? (
          <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
        ) : (
          <Bot className="size-4" data-icon="inline-start" />
        )}
        Reativar bot
      </Button>
      {pausedLabel || reason || pausedConversationCount ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {pausedLabel ? `Pausado em ${pausedLabel}. ` : ""}
          {pausedConversationCount && pausedConversationCount > 1
            ? `${pausedConversationCount} conversas em handoff. `
            : ""}
          {reason ? `Motivo: ${reason}.` : ""}
        </p>
      ) : null}
    </div>
  );
}
