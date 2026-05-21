"use client";

// AI Agent — config inline dentro do card do canvas.
//
// PR 21 UX (mai/2026): substitui o NodeConfigSheet (Sheet lateral)
// por config inline dentro do próprio body do node, inspirado no
// Jordan/ManyChat. Cliente clica no node → ele expande → form aparece
// dentro do card.
//
// Pattern de bridge:
// - Mantém local `draft` state sincronizado com `node.data` (Forms
//   existentes usam `draft + setDraft` — não refatoramos eles)
// - Debounce 200ms — toda mudança no draft propaga pra canvas via
//   `onPatch(data)`. Não persiste no DB (só salva no botão "Salvar"
//   global do canvas).
// - Sync inbound: se `node.data` muda externamente (ex: import), o
//   draft é resetado.

import * as React from "react";
import {
  ActionForm,
  AIAgentForm,
  ConditionForm,
  EntryForm,
} from "./NodeConfigSheet";
import type { FlowCatalogs } from "./catalog-types";
import type { FlowNode } from "@persia/shared/ai-agent";

interface Props {
  /** Tipo + data atual do node (apenas para escolher o form certo). */
  nodeType: FlowNode["type"];
  /** Snapshot atual de node.data — usado pra inicializar/sincronizar draft. */
  data: Record<string, unknown>;
  /** Callback chamado com o draft completo após debounce. Caller deve
   * atualizar o estado do node no canvas. */
  onPatch: (data: Record<string, unknown>) => void;
  catalogs: FlowCatalogs;
  catalogsLoading?: boolean;
}

const DEBOUNCE_MS = 200;

export function InlineFormPanel({
  nodeType,
  data,
  onPatch,
  catalogs,
  catalogsLoading,
}: Props) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>(data);

  // Sync inbound: se a `data` mudar de fora (ex: cliente abre outro
  // node ou faz undo), zera o draft. Comparamos por referência — caller
  // garante que passa a mesma ref enquanto edita.
  const lastDataRef = React.useRef(data);
  React.useEffect(() => {
    if (lastDataRef.current !== data) {
      lastDataRef.current = data;
      setDraft(data);
    }
  }, [data]);

  // Sync outbound debounced: toda vez que draft muda, propaga pro
  // canvas após 200ms. Evita centenas de updates por keystroke.
  React.useEffect(() => {
    if (draft === data) return; // nada mudou
    const handle = window.setTimeout(() => {
      onPatch(draft);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="space-y-3 nodrag" onClick={(e) => e.stopPropagation()}>
      {nodeType === "entry" && (
        <EntryForm
          draft={draft}
          setDraft={setDraft}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      )}
      {nodeType === "ai_agent" && (
        <AIAgentForm draft={draft} setDraft={setDraft} />
      )}
      {nodeType === "action" && (
        <ActionForm
          draft={draft}
          setDraft={setDraft}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      )}
      {nodeType === "condition" && (
        <ConditionForm
          draft={draft}
          setDraft={setDraft}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      )}
    </div>
  );
}
