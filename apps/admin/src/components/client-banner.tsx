"use client";

import { useShellContext } from "@/lib/shell-context";
import { clearAdminContextAction } from "@/actions/admin";
import { ArrowLeft, Building2 } from "lucide-react";
import { useEffect } from "react";

export function ClientBanner() {
  const { mode, clientOrgName } = useShellContext();

  // Add/remove visual indicator class on body when managing client
  useEffect(() => {
    if (mode === "client") {
      document.body.classList.add("managing-client");
    } else {
      document.body.classList.remove("managing-client");
    }
    return () => document.body.classList.remove("managing-client");
  }, [mode]);

  if (mode !== "client") return null;

  async function handleReturnToAdmin() {
    await clearAdminContextAction();
    window.location.href = "/";
  }

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2.5 flex items-center justify-between text-sm shrink-0 shadow-sm">
      <div className="flex items-center gap-2">
        <Building2 className="size-4" />
        <span>
          Acessando <strong>{clientOrgName}</strong>
        </span>
      </div>
      <button
        onClick={handleReturnToAdmin}
        className="flex items-center gap-1.5 px-3 py-1 bg-amber-950/10 hover:bg-amber-950/20 text-amber-950 rounded-lg text-xs font-semibold transition-colors border border-amber-950/20"
      >
        <ArrowLeft className="size-3" />
        Retornar ao admin
      </button>
    </div>
  );
}
