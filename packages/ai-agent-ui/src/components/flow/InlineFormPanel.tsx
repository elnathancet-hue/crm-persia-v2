"use client";

// AI Agent — config inline dentro do card do canvas.
//
// PR 21 UX (mai/2026): substitui o NodeConfigSheet (Sheet lateral)
// por config inline dentro do próprio body do node, inspirado no
// Jordan/ManyChat. Cliente clica no node → ele expande → form aparece
// dentro do card.
//
// Pattern de bridge:
// - Mantém local `draft` state — fonte da verdade enquanto o componente
//   está montado.
// - Debounce 200ms — toda mudança no draft propaga pra canvas via
//   `onPatch(data)`. Não persiste no DB (só salva no botão "Salvar"
//   global do canvas).
// - Troca de node: `<InlineFormPanel key={node.id}>` no caller força
//   remount — draft inicializa do node novo. Limpa e sem race.
//
// Fix mai/2026: bug pre-existente. useEffect "inbound" antigo
// (`if (lastDataRef.current !== data) setDraft(data)`) sobrescrevia
// keystrokes do cliente quando o canvas re-renderizava por causa do
// PROPRIO onPatch. Sequencia:
//   1. Cliente digita "a" -> setDraft({a})
//   2. Debounce 200ms -> onPatch({a}) -> setNodes no canvas
//   3. Cliente digita "b" durante a re-render do canvas -> setDraft({ab})
//   4. Canvas termina re-render -> `data` prop chega como {a} (ref nova)
//   5. Inbound useEffect: lastRef !== data -> setDraft({a}) <- perde "b"
// Cliente reportava "nao consigo digitar". Fix: remover o useEffect
// inbound. Cliente trocar de node ja remonta o componente via key={id}.

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
  /** Snapshot atual de node.data — usado APENAS pra inicializar o draft.
   * Mudancas em `data` apos o mount NAO ressincronizam o draft.
   * Caller troca de node via key={id} pra forcar remount. */
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
  // Inicializa SO no mount (lazy initializer). `data` posterior nao
  // re-inicializa — draft eh fonte da verdade enquanto montado.
  const [draft, setDraft] = React.useState<Record<string, unknown>>(
    () => data,
  );

  // Sync outbound debounced: toda vez que draft muda, propaga pro
  // canvas após 200ms. Evita centenas de updates por keystroke.
  //
  // Comparacao `draft === data` evita ping-pong (1a render quando draft
  // === data inicial). Apos primeiro keystroke, draft muda de ref e
  // entra no caminho de debounce.
  React.useEffect(() => {
    if (draft === data) return;
    const handle = window.setTimeout(() => {
      onPatch(draft);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    // Fix mai/2026: ReactFlow tem 3 classes especiais que precisam estar
    // em qualquer elemento que deveria escapar do canvas behavior:
    //   - nodrag: impede drag do node quando mousedown no elemento
    //   - nopan:  impede pan do canvas (translate da viewport)
    //   - nowheel: impede zoom do canvas via scroll wheel
    // Antes so tinha `nodrag`. Sintoma: input/textarea no panel inline
    // perdiam focus instantaneamente porque o `nopan` faltante deixava
    // ReactFlow consumir o mousedown pra iniciar pan do canvas. Cliente
    // nao conseguia digitar.
    //
    // Fix mai/2026 (cont.): adicionar onMouseDown + onPointerDown.
    // ReactFlow escuta pointer/mouse, NAO click. Antes so tinha
    // `onClick stopPropagation` — nao adiantava porque o evento que
    // dispara drag/pan eh o pointerdown/mousedown, nao click. Cliente
    // continuava sem conseguir digitar mesmo com nodrag/nopan/nowheel
    // porque alguns shadcn components (Select, Popover) tem portais
    // que escapam do tree DOM — handlers aqui sao defesa em profundidade.
    // NAO usar preventDefault — isso quebraria focus nativo nos campos.
    <div
      className="space-y-3 nodrag nopan nowheel"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {nodeType === "entry" && (
        <EntryForm
          draft={draft}
          setDraft={setDraft}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      )}
      {nodeType === "ai_agent" && (
        <AIAgentForm
          draft={draft}
          setDraft={setDraft}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
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
