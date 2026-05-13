"use client";

// PR-V1a (movido de apps/crm/src/lib/realtime, parte do S2):
// preferencia de mute pra toasts de realtime (comentario novo, lead
// atribuido). Single source of truth — qualquer hook que dispara toast
// checa antes.
//
// Persistencia: localStorage (per-browser, per-origin). Sync entre abas
// via 'storage' event nativo do browser. Origins distintos (CRM vs
// admin) tem buckets independentes — intencional: user pode mutar so
// no admin sem afetar o CRM.
//
// Por que NAO Supabase preferences table? Toast UX e local ao
// browser/device. User pode querer toast no notebook e mute no
// celular. Server-side seria over-engineering.
//
// Hook puro (sem supabase) — DI nao se aplica. A KEY mantem o prefixo
// "crm:" por compat com prefs existentes do CRM cliente.

import { useEffect, useState } from "react";

const STORAGE_KEY = "crm:toast:muted";

function readMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (muted) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
    // Notifica outros consumidores na mesma tab (storage event so
    // dispara em OUTRAS abas — pra mesma aba usamos um custom event).
    window.dispatchEvent(new Event("crm:toast-prefs-changed"));
  } catch {
    // localStorage indisponivel (privacy mode) — silencioso
  }
}

export function useToastMuted(): [boolean, (next: boolean) => void] {
  // PR-B8: SSR always inicializa `false` pra evitar hydration mismatch
  // (auditoria E2E 2026-05-13). O lazy initializer anterior (`useState(()
  // => readMuted())`) rodava client-side com localStorage e retornava
  // potencialmente `true`, divergindo do SSR onde `typeof window` e
  // "undefined" e readMuted retorna `false`. Quando o user tinha mute
  // ativo, o Bell/BellOff icone + label "Silenciar"/"Notificações
  // silenciadas" no header divergiam — React #418.
  //
  // Estrategia: SSR renderiza com `false`, useEffect sincroniza
  // pos-hidratacao. Flicker minimo (icone Bell ↔ BellOff por ~1 frame
  // em users com mute ativo) — aceitavel pra evitar warning.
  const [muted, setMuted] = useState<boolean>(false);

  useEffect(() => {
    // Sync inicial: le do localStorage so depois da hidratacao.
    setMuted(readMuted());

    // Sync entre abas: 'storage' event nativo
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setMuted(readMuted());
    };
    // Sync na mesma aba: custom event disparado por writeMuted
    const onLocal = () => setMuted(readMuted());

    window.addEventListener("storage", onStorage);
    window.addEventListener("crm:toast-prefs-changed", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("crm:toast-prefs-changed", onLocal);
    };
  }, []);

  const setter = (next: boolean) => {
    writeMuted(next);
    setMuted(next);
  };

  return [muted, setter];
}

/**
 * Versao read-only pra hooks que so precisam consultar.
 * Mesma sync de eventos.
 */
export function useIsToastMuted(): boolean {
  const [muted] = useToastMuted();
  return muted;
}
