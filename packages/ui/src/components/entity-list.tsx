"use client";

import * as React from "react";
import { cn } from "../utils";

export interface EntityListProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: "comfortable" | "compact";
}

export function EntityList({
  className,
  density = "comfortable",
  ...props
}: EntityListProps) {
  return (
    <div
      data-slot="entity-list"
      data-density={density}
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface EntityRowProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  avatar?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
  badges?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export function EntityRow({
  avatar,
  title,
  subtitle,
  description,
  badges,
  meta,
  actions,
  selected = false,
  disabled = false,
  onPress,
  className,
  ...props
}: EntityRowProps) {
  const interactive = Boolean(onPress) && !disabled;

  return (
    <div
      data-slot="entity-row"
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onPress : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPress?.();
              }
            }
          : undefined
      }
      className={cn(
        "group/entity-row flex min-h-16 items-center gap-stack border-b border-border/50 px-card py-3 text-left outline-none transition-colors last:border-b-0",
        interactive && "cursor-pointer hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
        selected && "bg-primary/5",
        disabled && "opacity-60",
        className,
      )}
      {...props}
    >
      {avatar && <div className="shrink-0">{avatar}</div>}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 truncate font-medium leading-5 text-foreground">
            {title}
          </div>
          {badges && <div className="flex shrink-0 flex-wrap items-center gap-1">{badges}</div>}
        </div>
        {subtitle && (
          <div className="truncate text-xs text-muted-foreground">
            {subtitle}
          </div>
        )}
        {description && (
          <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {meta && <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">{meta}</div>}
      {actions && (
        <div
          className="shrink-0"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

