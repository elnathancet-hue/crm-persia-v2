"use client";

import * as React from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import type { BookingPage } from "@persia/shared/agenda";
import { BookingPageStatusBadge } from "./BookingPageStatusBadge";

interface BookingPageCardProps {
  page: BookingPage;
  /** Slug da org pra montar a URL. */
  orgSlug: string;
  /** Origin pra gerar a URL completa. Default: typeof window. */
  origin?: string;
  onEdit?: (page: BookingPage) => void;
  onDuplicate?: (page: BookingPage) => void;
  onDelete?: (page: BookingPage) => void;
}

function buildBookingUrl(
  origin: string,
  orgSlug: string,
  pageSlug: string,
): string {
  return `${origin}/agendar/${orgSlug}/${pageSlug}`;
}

export const BookingPageCard: React.FC<BookingPageCardProps> = ({
  page,
  orgSlug,
  origin,
  onEdit,
  onDuplicate,
  onDelete,
}) => {
  const [copied, setCopied] = React.useState(false);
  const resolvedOrigin =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const url = buildBookingUrl(resolvedOrigin, orgSlug, page.slug);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Browsers sem clipboard — silencia
    }
  };

  // PR-AGENDA-DS Fase 2 (mai/2026): rounded-xl + Button DS + tipografia consistente.
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-foreground">
            {page.title}
          </h4>
          {page.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {page.description}
            </p>
          )}
        </div>
        <BookingPageStatusBadge status={page.status} />
      </div>

      <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
        <p>
          <span className="font-semibold">Duração:</span> {page.duration_minutes} min
          {page.buffer_minutes > 0 && (
            <span className="text-muted-foreground/70">
              {" "}
              · buffer {page.buffer_minutes} min
            </span>
          )}
        </p>
        <p>
          <span className="font-semibold">Janela:</span> próximos{" "}
          {page.lookahead_days} dia{page.lookahead_days === 1 ? "" : "s"}
        </p>
        <p>
          <span className="font-semibold">Reservas:</span>{" "}
          <span className="tabular-nums">{page.total_bookings}</span>
        </p>
      </div>

      {/* URL preview + copy */}
      <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          URL pública
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <code className="truncate text-xs font-mono text-foreground">
            {url}
          </code>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleCopy}
              aria-label="Copiar URL"
            >
              {copied ? (
                <CheckCircle2 className="size-3 text-success" />
              ) : (
                <Copy className="size-3" />
              )}
            </Button>
            {page.status === "active" && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Abrir página"
                render={
                  <a href={url} target="_blank" rel="noopener noreferrer" />
                }
              >
                <ExternalLink className="size-3" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {onDuplicate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDuplicate(page)}
          >
            <Copy className="size-3" data-icon="inline-start" />
            Duplicar
          </Button>
        )}
        {onEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(page)}
          >
            <Pencil className="size-3" data-icon="inline-start" />
            Editar
          </Button>
        )}
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDelete(page)}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3" data-icon="inline-start" />
            Excluir
          </Button>
        )}
      </div>
    </div>
  );
};
