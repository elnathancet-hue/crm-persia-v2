"use client";

import { useShellContext } from "@/lib/shell-context";
import { clearAdminContextAction } from "@/actions/admin";
import { Building2 } from "lucide-react";

export function HeaderOrgBadge() {
  const { mode, clientOrgName } = useShellContext();

  async function handleReturn() {
    await clearAdminContextAction();
    window.location.href = "/";
  }

  const displayName = mode === "client" ? clientOrgName : "Admin Persia";

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs ${
          mode === "client"
            ? "bg-primary/10 border border-primary/30 text-primary"
            : "bg-muted border border-border text-muted-foreground"
        }`}
      >
        <Building2 className="size-3" />
        <span>{displayName}</span>
      </div>
      {mode === "client" && (
        <button
          onClick={handleReturn}
          className="text-[10px] text-primary hover:text-primary/80 transition-colors"
        >
          Retornar
        </button>
      )}
    </div>
  );
}
