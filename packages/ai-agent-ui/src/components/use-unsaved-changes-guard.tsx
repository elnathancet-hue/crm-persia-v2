"use client";

// PR 27 (mai/2026): UnsavedChangesGuard — avisa o cliente antes de
// sair da tela com mudanças não salvas.
//
// Duas camadas de proteção:
//
// 1. window.beforeunload (reload, fechar aba, navegar pra URL externa)
//    Browser mostra dialog NATIVO genérico. Não dá pra customizar
//    texto desde 2017 (browsers ignoram returnValue string), mas a
//    presença do event.preventDefault dispara o prompt. Garantido
//    em 100% dos cenários de saída externa.
//
// 2. Intercept de cliques em <a> internos (navegação Next.js Link)
//    capture-phase listener em `document` que pega cliques em <a>
//    com href interno (mesma origem). preventDefault + abre
//    AlertDialog customizado com 2 botões:
//      - "Continuar editando" (fica)
//      - "Sair sem salvar" (router.push pro destino capturado)
//    Coberta a maioria das saídas: clique em link da sidebar,
//    breadcrumb, "Voltar pra lista", etc.
//
// O que NÃO está coberto (limitação conhecida):
//   - router.push() programático sem clique
//   - Browser back/forward (history navigation) — browsers
//     restringem intercept de back desde 2022 por privacidade.
//     beforeunload pega quando back navega pra origem diferente.
//
// Uso:
//   <UnsavedChangesGuard dirty={dirty} />
//   // Renderiza no nível do componente que tem o dirty state.
//   // Pode ter múltiplos <UnsavedChangesGuard> ativos (cada um com
//   // seu próprio dirty) — listeners coexistem sem conflito.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@persia/ui/alert-dialog";

interface PendingNav {
  href: string;
}

interface Props {
  dirty: boolean;
  /** Texto custom no body do dialog. Default genérico. */
  message?: string;
}

export function UnsavedChangesGuard({ dirty, message }: Props) {
  const router = useRouter();
  // dirtyRef mantém valor atual sem re-bind dos listeners.
  const dirtyRef = React.useRef(dirty);
  React.useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const [pendingNav, setPendingNav] = React.useState<PendingNav | null>(null);

  // -- Camada 1: beforeunload --
  React.useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // returnValue legado pra navegadores antigos — browsers
      // modernos ignoram a string mas ainda mostram dialog próprio.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // -- Camada 2: intercept de Link clicks (navegação Next.js) --
  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (!dirtyRef.current) return;
      // Modifier keys = nova aba/janela — user QUER sair sem
      // prejudicar o atual. Deixa passar.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return;

      // Sobe até achar <a> ou desistir.
      let el = e.target as HTMLElement | null;
      while (el && el.tagName !== "A") {
        el = el.parentElement;
      }
      if (!el) return;

      const anchor = el as HTMLAnchorElement;
      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;
      // Skip ancoras (#section), mailto, tel, javascript:
      if (
        rawHref.startsWith("#") ||
        rawHref.startsWith("mailto:") ||
        rawHref.startsWith("tel:") ||
        rawHref.startsWith("javascript:")
      ) {
        return;
      }
      // External que NÃO é mesma origem — beforeunload cuida.
      let url: URL;
      try {
        url = new URL(rawHref, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Mesma página? Não bloqueia.
      const currentPath = window.location.pathname + window.location.search;
      const targetPath = url.pathname + url.search;
      if (targetPath === currentPath) return;
      // target=_blank também sai sem prejudicar a tela atual.
      if (anchor.target === "_blank") return;

      e.preventDefault();
      e.stopPropagation();
      setPendingNav({ href: targetPath + url.hash });
    }
    // Capture phase pra interceptar ANTES do Link handler do Next.
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  const handleConfirmExit = React.useCallback(() => {
    if (!pendingNav) return;
    const target = pendingNav.href;
    setPendingNav(null);
    // Reset ref ANTES do push pra não disparar de novo se houver
    // re-render rápido enquanto router navega.
    dirtyRef.current = false;
    router.push(target);
  }, [pendingNav, router]);

  if (!pendingNav) return null;

  return (
    <AlertDialog open onOpenChange={(open) => !open && setPendingNav(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Este projeto não foi salvo</AlertDialogTitle>
          <AlertDialogDescription>
            {message ??
              "Você tem mudanças que ainda não foram salvas. Se sair agora, vai perder essas alterações."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setPendingNav(null)}>
            Continuar editando
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmExit}>
            Sair sem salvar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Backwards-compat alias — algumas docs mencionam `useUnsavedChangesGuard`
// como hook. Como componente é mais simples (sem portal trick), wrappamos
// num "hook" que retorna o JSX a renderizar.
//
// Uso:
//   const guard = useUnsavedChangesGuard(dirty);
//   return <>{...}{guard}</>;
export function useUnsavedChangesGuard(
  dirty: boolean,
  message?: string,
): React.ReactNode {
  return <UnsavedChangesGuard dirty={dirty} message={message} />;
}
