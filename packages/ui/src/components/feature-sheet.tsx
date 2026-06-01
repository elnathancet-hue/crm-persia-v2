"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./sheet";
import { cn } from "../utils";

const FEATURE_SHEET_SIZE_CLASSES = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export interface FeatureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  summary?: React.ReactNode;
  footer?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  size?: keyof typeof FEATURE_SHEET_SIZE_CLASSES;
  showCloseButton?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

export function FeatureSheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
  summary,
  footer,
  side = "right",
  size = "lg",
  showCloseButton = true,
  className,
  bodyClassName,
  children,
}: FeatureSheetProps) {
  const isHorizontal = side === "left" || side === "right";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        showCloseButton={showCloseButton}
        className={cn(
          isHorizontal && "w-full",
          isHorizontal && FEATURE_SHEET_SIZE_CLASSES[size],
          "overflow-hidden",
          className,
        )}
      >
        <SheetHeader className="pr-12">
          <div className="flex items-start justify-between gap-stack">
            <div className="min-w-0 flex-1">
              <SheetTitle>{title}</SheetTitle>
              {description && (
                <SheetDescription className="mt-1">
                  {description}
                </SheetDescription>
              )}
            </div>
            {actions && (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-inline">
                {actions}
              </div>
            )}
          </div>
        </SheetHeader>
        <div
          data-slot="feature-sheet-body"
          className={cn("flex-1 overflow-y-auto px-card py-4", bodyClassName)}
        >
          <div className="space-y-stack-lg">
            {summary && <div>{summary}</div>}
            {children}
          </div>
        </div>
        {footer && <SheetFooter>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}

