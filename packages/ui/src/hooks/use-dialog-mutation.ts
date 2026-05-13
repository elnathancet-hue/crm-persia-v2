"use client";

import { useCallback, useTransition } from "react";
import { toast } from "sonner";

import type { ActionResult } from "../types/action-result";

/**
 * Hook padrão pra Dialog / AlertDialog / Sheet que executa uma Server Action
 * e precisa fechar + mostrar toast + tratar erro de forma consistente.
 *
 * Resolve os bugs recorrentes:
 *  - Modal que não fecha após salvar (B-S1, B-T1..T5, regressão PR-B3)
 *  - Toast duplicado / faltando (B-N4)
 *  - Tela branca quando action faz `throw` (Application error digest)
 *  - Estado de loading inconsistente
 *
 * @example
 * const { run, pending } = useDialogMutation({
 *   mutation: (input: { name: string }) => updateLeadAction(leadId, input),
 *   onOpenChange,
 *   successToast: "Lead atualizado",
 *   errorToast: (err) => `Não foi possível salvar: ${err}`,
 *   onSuccess: () => router.refresh(),
 *   toastId: `lead-${leadId}`,
 * });
 *
 * <form action={(fd) => run({ name: String(fd.get("name")) })}>
 *   <Button type="submit" disabled={pending}>Salvar</Button>
 * </form>
 *
 * Referências:
 *   - packages/ui/docs/patterns.md (Pattern #1)
 */
export interface UseDialogMutationOptions<TInput, TOutput = unknown> {
  /** Server Action a invocar. Pode retornar ActionResult ou void. */
  mutation: (input: TInput) => Promise<ActionResult<TOutput>>;
  /** Callback do Dialog/Sheet (`setOpen` / `onOpenChange`). Recebe `false` no sucesso. */
  onOpenChange?: (open: boolean) => void;
  /** Mensagem ou função pra toast de sucesso. Passar `false` desativa. */
  successToast?: string | ((data: TOutput | undefined) => string) | false;
  /** Mensagem ou função pra toast de erro. Passar `false` desativa. */
  errorToast?: string | ((error: string) => string) | false;
  /** Callback opcional no sucesso (ex: `router.refresh`). */
  onSuccess?: (data: TOutput | undefined) => void | Promise<void>;
  /** Callback opcional no erro. */
  onError?: (error: string) => void;
  /**
   * ID estável pro toast (sonner). Use quando o mesmo Dialog pode ser aberto
   * em sequência rápida pra evitar empilhamento de toasts.
   */
  toastId?: string;
}

export interface UseDialogMutationReturn<TInput, TOutput = unknown> {
  /** Dispara a mutation. Retorna ActionResult resolvido (nunca rejeita). */
  run: (input: TInput) => Promise<ActionResult<TOutput>>;
  /** True enquanto a action está pendente. Use pra desabilitar botão / mostrar spinner. */
  pending: boolean;
}

const DEFAULT_TOAST_DURATION = 5000;

function resolveMessage<T>(
  raw: string | ((value: T) => string) | false | undefined,
  value: T,
  fallback?: string,
): string | null {
  if (raw === false) return null;
  if (typeof raw === "function") return raw(value);
  if (typeof raw === "string") return raw;
  return fallback ?? null;
}

export function useDialogMutation<TInput, TOutput = unknown>(
  options: UseDialogMutationOptions<TInput, TOutput>,
): UseDialogMutationReturn<TInput, TOutput> {
  const {
    mutation,
    onOpenChange,
    successToast,
    errorToast,
    onSuccess,
    onError,
    toastId,
  } = options;
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (input: TInput) =>
      new Promise<ActionResult<TOutput>>((resolve) => {
        startTransition(async () => {
          let result: ActionResult<TOutput>;
          try {
            result = await mutation(input);
          } catch (err) {
            // Server Action lançou exceção (não deveria, mas defendemos).
            // Converte pra ActionResult com mensagem amigável.
            const message =
              err instanceof Error && err.message
                ? err.message
                : "Erro inesperado. Tente novamente.";
            result = { error: message };
          }

          if (result && typeof result === "object" && "error" in result && result.error) {
            const message = resolveMessage(errorToast, result.error, result.error);
            if (message) {
              toast.error(message, {
                id: toastId,
                duration: DEFAULT_TOAST_DURATION,
              });
            }
            onError?.(result.error);
            resolve(result);
            return;
          }

          // Sucesso (ActionResult.data ou void)
          const data =
            result && typeof result === "object" && "data" in result
              ? (result.data as TOutput | undefined)
              : undefined;

          const message = resolveMessage(successToast, data);
          if (message) {
            toast.success(message, {
              id: toastId,
              duration: DEFAULT_TOAST_DURATION,
            });
          }

          // Fechar dialog ANTES do onSuccess pra evitar flicker
          onOpenChange?.(false);

          try {
            await onSuccess?.(data);
          } catch {
            // onSuccess não deve quebrar o fluxo
          }

          resolve(result);
        });
      }),
    [mutation, onOpenChange, successToast, errorToast, onSuccess, onError, toastId],
  );

  return { run, pending };
}
