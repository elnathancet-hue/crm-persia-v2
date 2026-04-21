"use client";

import { Building2 } from "lucide-react";
import { useShellContext } from "@/lib/shell-context";

/**
 * Shows a fallback message when a CRM page is accessed without an active client context.
 * Uses server-derived shell context (not Zustand) to avoid hydration race conditions.
 * Returns null if in client mode (context is active).
 */
export function NoContextFallback() {
  const { mode } = useShellContext();

  // If server says we're in client mode, don't show fallback
  if (mode === "client") return null;

  return (
    <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
      <div className="size-12 rounded-full bg-muted flex items-center justify-center">
        <Building2 className="size-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">Nenhuma conta selecionada</p>
        <p className="text-xs text-muted-foreground mt-1">Selecione uma conta no painel lateral para acessar esta pagina.</p>
      </div>
    </div>
  );
}
