// AI Agent — provider stub do Tester (modo flow).
//
// PR-FLOW-PIVOT PR 2 (mai/2026): substitui o tester-provider.ts antigo
// (deletado no PR 1). Captura todos os "envios" do agente em array de
// eventos pra UI reconstruir a timeline. Não bate em UAZAPI/Meta.
//
// Modo produção (PR 2b) usa um adapter equivalente que delega pro
// WhatsAppProvider real (createProvider de @persia/shared/providers).

import type { FlowProviderStub, TesterRunEvent } from "./types";

export interface CreateTesterProviderOptions {
  /** Optional "now" override pra tests deterministicos. Default Date.now. */
  clock?: () => number;
}

export function createTesterProvider(
  options: CreateTesterProviderOptions = {},
): FlowProviderStub {
  const clock = options.clock ?? (() => Date.now());
  const events: TesterRunEvent[] = [];

  return {
    emit(event) {
      events.push({ ts: clock(), ...event });
    },
    getEvents() {
      return events.slice();
    },
  };
}
