"use client";

// PR 26 (mai/2026): useSaveStatus — state machine pequeno pro
// indicador de "Salvando/Salvo/Erro" no header.
//
// Estados:
//   - idle: nenhuma operação rolando. Indicator não renderiza (nada
//     a comunicar).
//   - saving: operação em curso. Indicator mostra spinner + "Salvando…".
//   - saved: última operação ok. Mostra "Salvo agora" (vira "há Xm"
//     depois). Limpa quando inicia novo save.
//   - error: última operação falhou. Mostra ícone alerta + mensagem
//     + botão retry. Limpa quando inicia novo save bem-sucedido.
//
// lastSavedAt: timestamp do último save ok. Usado pelo indicator
// pra renderizar "há Xm" relativo a now. setInterval no component
// força re-render a cada 30s pra manter timestamp atualizado.
//
// errorMessage: texto cru do erro pra mostrar no tooltip. Usuário
// raramente lê (UI mostra só "Erro ao salvar"), mas serve pra
// debug e pra screen readers.

import * as React from "react";

export type SaveStatusState = "idle" | "saving" | "saved" | "error";

export interface UseSaveStatusReturn {
  status: SaveStatusState;
  lastSavedAt: Date | null;
  errorMessage: string | null;
  markSaving: () => void;
  markSaved: () => void;
  markError: (message: string) => void;
  reset: () => void;
}

export function useSaveStatus(): UseSaveStatusReturn {
  const [status, setStatus] = React.useState<SaveStatusState>("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const markSaving = React.useCallback(() => {
    setStatus("saving");
    setErrorMessage(null);
  }, []);

  const markSaved = React.useCallback(() => {
    setStatus("saved");
    setLastSavedAt(new Date());
    setErrorMessage(null);
  }, []);

  const markError = React.useCallback((message: string) => {
    setStatus("error");
    setErrorMessage(message);
    // lastSavedAt NÃO é resetado — usuário pode querer saber quando
    // foi o último save bem-sucedido (antes do erro).
  }, []);

  const reset = React.useCallback(() => {
    setStatus("idle");
    setLastSavedAt(null);
    setErrorMessage(null);
  }, []);

  return {
    status,
    lastSavedAt,
    errorMessage,
    markSaving,
    markSaved,
    markError,
    reset,
  };
}
