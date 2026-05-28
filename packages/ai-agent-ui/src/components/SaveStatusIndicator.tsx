"use client";

// PR 26 (mai/2026): SaveStatusIndicator — visual do save status.
//
// Renderiza chip pequeno no header com ícone + texto. Estados:
//   - idle: NÃO renderiza (nada a comunicar). Componente devolve null.
//   - saving: <Loader2 spin /> "Salvando…"
//   - saved: <Check /> "Salvo agora" → "Salvo há 1m" → "Salvo há 5m"
//   - error: <AlertCircle /> "Não foi possível salvar" + botão retry
//
// Time-ago em "saved": re-render a cada 30s via setInterval. Limpo no
// unmount + quando status muda de "saved" pra outro. Texto formatado
// com Intl.RelativeTimeFormat (locale do browser, default pt-BR no
// CRM por causa do `<html lang="pt-BR">`).
//
// Tooltip mostra errorMessage cru pra debug — mensagem da UI é
// sempre amigável "Não foi possível salvar".

import * as React from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { SaveStatusState } from "./use-save-status";

interface Props {
  status: SaveStatusState;
  lastSavedAt: Date | null;
  errorMessage: string | null;
  /** Botão "Tentar de novo" renderizado quando status=error.
   * Quando omitido, só mostra a mensagem (sem retry). */
  onRetry?: () => void;
  /** Save flow fix #4 (mai/2026): bandeira de dirty derivada do
   * RulesTab. Quando true, indicator mostra "Alterações não salvas"
   * em vez de "Salvo agora" — mantendo header e footer consistentes.
   * Sem isso, status change isolado deixava header em "saved" enquanto
   * o prompt continuava com mudanças pendentes (UX confusa). */
  isDirty?: boolean;
}

export function SaveStatusIndicator({
  status,
  lastSavedAt,
  errorMessage,
  onRetry,
  isDirty,
}: Props) {
  // Force re-render a cada 30s quando em estado "saved" pra atualizar
  // o "há Xm". Sem isso, o texto fica congelado em "agora" pra sempre.
  const [, forceRerender] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (status !== "saved") return;
    const interval = setInterval(forceRerender, 30000);
    return () => clearInterval(interval);
  }, [status]);

  // Save flow fix #4: dirty override no idle/saved — server respondeu
  // mas o usuário tem mudanças locais pendentes em outro campo.
  if (isDirty && (status === "idle" || status === "saved")) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-foreground">
        <span className="size-2 rounded-full bg-warning animate-pulse" />
        <span>Alterações não salvas</span>
      </div>
    );
  }

  if (status === "idle") return null;

  if (status === "saving") {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span>Salvando…</span>
      </div>
    );
  }

  if (status === "saved") {
    return (
      <div
        className="inline-flex items-center gap-1.5 text-xs text-success"
        title={lastSavedAt ? `Salvo às ${lastSavedAt.toLocaleTimeString()}` : undefined}
      >
        <Check className="size-3.5" />
        <span>{formatRelative(lastSavedAt)}</span>
      </div>
    );
  }

  // status === "error"
  return (
    <div className="inline-flex items-center gap-2 text-xs">
      <div
        className="inline-flex items-center gap-1.5 text-destructive"
        title={errorMessage ?? undefined}
      >
        <AlertCircle className="size-3.5" />
        <span>Não foi possível salvar</span>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="text-primary hover:underline font-medium"
        >
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

/**
 * Formata um timestamp como "Salvo agora", "Salvo há 1m", "Salvo há
 * 1h", etc. Aproximações pra UI — não precisa ser exato.
 */
function formatRelative(date: Date | null): string {
  if (!date) return "Salvo agora";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return "Salvo agora";
  if (diffSec < 90) return "Salvo há 1m";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Salvo há ${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `Salvo há ${diffHour}h`;
  return `Salvo há ${Math.floor(diffHour / 24)}d`;
}
