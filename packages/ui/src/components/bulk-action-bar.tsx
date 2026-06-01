"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "../utils";

export interface BulkActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  selectedCount: number;
  label?: React.ReactNode;
  onClear?: () => void;
}

export function BulkActionBar({
  selectedCount,
  label,
  onClear,
  children,
  className,
  ...props
}: BulkActionBarProps) {
  if (selectedCount <= 0) return null;

  return (
    <div
      data-slot="bulk-action-bar"
      className={cn(
        "flex flex-wrap items-center justify-between gap-stack rounded-xl border border-primary/20 bg-primary/5 px-card py-3 text-sm text-foreground",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-inline">
        {onClear && (
          <Button variant="ghost" size="icon-xs" onClick={onClear} aria-label="Limpar selecao">
            <X className="size-3.5" />
          </Button>
        )}
        <span className="font-medium">
          {label ?? `${selectedCount} selecionado${selectedCount === 1 ? "" : "s"}`}
        </span>
      </div>
      {children && (
        <div className="flex flex-wrap items-center justify-end gap-inline">
          {children}
        </div>
      )}
    </div>
  );
}

