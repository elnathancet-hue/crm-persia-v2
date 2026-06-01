"use client";

import * as React from "react";
import { cn } from "../utils";

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  search?: React.ReactNode;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  density?: "comfortable" | "compact";
}

export function Toolbar({
  search,
  filters,
  actions,
  density = "comfortable",
  className,
  children,
  ...props
}: ToolbarProps) {
  return (
    <div
      data-slot="toolbar"
      data-density={density}
      className={cn(
        "flex flex-wrap items-center justify-between gap-stack",
        density === "comfortable" ? "py-1" : "py-0",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-inline">
        {search && <div className="min-w-52 flex-1 sm:max-w-sm">{search}</div>}
        {filters}
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-inline">
          {actions}
        </div>
      )}
    </div>
  );
}

