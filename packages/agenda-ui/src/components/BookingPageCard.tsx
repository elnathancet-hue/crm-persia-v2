"use client";

import * as React from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react";
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

  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-slate-900">
            {page.title}
          </h4>
          {page.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">
              {page.description}
            </p>
          )}
        </div>
        <BookingPageStatusBadge status={page.status} />
      </div>

      <div className="mt-4 space-y-1.5 text-[11px] text-slate-600">
        <p>
          <span className="font-bold">Duração:</span> {page.duration_minutes} min
          {page.buffer_minutes > 0 && (
            <span className="text-slate-400">
              {" "}
              · buffer {page.buffer_minutes} min
            </span>
          )}
        </p>
        <p>
          <span className="font-bold">Janela:</span> próximos{" "}
          {page.lookahead_days} dia{page.lookahead_days === 1 ? "" : "s"}
        </p>
        <p>
          <span className="font-bold">Reservas:</span>{" "}
          <span className="tabular-nums">{page.total_bookings}</span>
        </p>
      </div>

      {/* URL preview + copy */}
      <div className="mt-4 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
          URL pública
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <code className="truncate text-[11px] font-mono text-slate-700">
            {url}
          </code>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copiar URL"
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white hover:text-indigo-600"
            >
              {copied ? (
                <CheckCircle2 size={12} className="text-emerald-600" />
              ) : (
                <Copy size={12} />
              )}
            </button>
            {page.status === "active" && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir página"
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white hover:text-indigo-600"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {onDuplicate && (
          <button
            type="button"
            onClick={() => onDuplicate(page)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-600 transition hover:bg-slate-100"
          >
            <Copy size={11} />
            Duplicar
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(page)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-indigo-600 transition hover:bg-indigo-50"
          >
            <Pencil size={11} />
            Editar
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(page)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-rose-600 transition hover:bg-rose-50"
          >
            <Trash2 size={11} />
            Excluir
          </button>
        )}
      </div>
    </div>
  );
};
