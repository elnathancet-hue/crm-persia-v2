"use client";

import * as React from "react";
import { CalendarPlus, Loader2, X } from "lucide-react";
import {
  type AgendaService,
  type BookingPage,
  type BookingPageStatus,
  BOOKING_PAGE_STATUSES,
  BOOKING_PAGE_STATUS_LABELS,
} from "@persia/shared/agenda";
import { useAgendaActions } from "../context";

interface BookingPageDrawerProps {
  open: boolean;
  /** Modo: edicao quando vem `existing`. */
  existing?: BookingPage | null;
  services: readonly AgendaService[];
  orgSlug: string;
  origin?: string;
  onClose: () => void;
  onSaved?: (page: BookingPage) => void;
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,49}$/;

function slugifyDraft(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export const BookingPageDrawer: React.FC<BookingPageDrawerProps> = ({
  open,
  existing = null,
  services,
  orgSlug,
  origin,
  onClose,
  onSaved,
}) => {
  const actions = useAgendaActions();
  const isEdit = Boolean(existing);

  const [title, setTitle] = React.useState(existing?.title ?? "");
  const [slug, setSlug] = React.useState(existing?.slug ?? "");
  const [slugTouched, setSlugTouched] = React.useState(Boolean(existing));
  const [description, setDescription] = React.useState(
    existing?.description ?? "",
  );
  const [duration, setDuration] = React.useState(
    existing?.duration_minutes ?? 60,
  );
  const [buffer, setBuffer] = React.useState(existing?.buffer_minutes ?? 0);
  const [lookahead, setLookahead] = React.useState(
    existing?.lookahead_days ?? 30,
  );
  const [status, setStatus] = React.useState<BookingPageStatus>(
    existing?.status ?? "draft",
  );
  const [serviceId, setServiceId] = React.useState<string | null>(
    existing?.service_id ?? null,
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset state quando trocar entre edit/create ou mudar existing
  React.useEffect(() => {
    setTitle(existing?.title ?? "");
    setSlug(existing?.slug ?? "");
    setSlugTouched(Boolean(existing));
    setDescription(existing?.description ?? "");
    setDuration(existing?.duration_minutes ?? 60);
    setBuffer(existing?.buffer_minutes ?? 0);
    setLookahead(existing?.lookahead_days ?? 30);
    setStatus(existing?.status ?? "draft");
    setServiceId(existing?.service_id ?? null);
    setError(null);
  }, [existing, open]);

  // Auto-slug enquanto o user nao tocou no campo slug
  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!slugTouched && !isEdit) {
      setSlug(slugifyDraft(v));
    }
  };

  // Validacao
  const errors = React.useMemo(() => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Título obrigatório";
    if (title.length > 100) e.title = "Máximo 100 caracteres";
    if (!slug) e.slug = "Slug obrigatório";
    else if (!SLUG_REGEX.test(slug))
      e.slug = "Use a-z, 0-9 e hífen (1-50 chars, comece com letra/número)";
    if (duration < 5 || duration > 1440)
      e.duration = "Duração entre 5 e 1440 min";
    if (buffer < 0 || buffer > 1440) e.buffer = "Buffer entre 0 e 1440 min";
    if (lookahead < 1 || lookahead > 365)
      e.lookahead = "Janela entre 1 e 365 dias";
    return e;
  }, [title, slug, duration, buffer, lookahead]);

  const isValid = Object.keys(errors).length === 0;
  const previewUrl = `${origin ?? (typeof window !== "undefined" ? window.location.origin : "")}/agendar/${orgSlug}/${slug || "..."}`;

  if (!open) return null;

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        slug,
        description: description.trim() || null,
        duration_minutes: duration,
        buffer_minutes: buffer,
        lookahead_days: lookahead,
        status,
        service_id: serviceId,
      };

      let saved: BookingPage;
      if (isEdit && existing) {
        saved = await actions.updateBookingPage(existing.id, payload);
      } else {
        saved = await actions.createBookingPage(payload);
      }
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="relative flex h-full w-full max-w-lg flex-col bg-card shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <CalendarPlus size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black text-foreground">
                {isEdit ? "Editar página" : "Nova página de agendamento"}
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Link público pra leads agendarem sozinhos
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-xl p-1.5 text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <Field label="Título" error={errors.title}>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Ex: Consulta inicial"
              aria-invalid={Boolean(errors.title)}
              className={inputCls(errors.title)}
            />
          </Field>

          <Field label="Slug (URL)" error={errors.slug}>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase());
                setSlugTouched(true);
              }}
              placeholder="consulta-inicial"
              aria-invalid={Boolean(errors.slug)}
              className={inputCls(errors.slug)}
            />
            <p className="mt-1.5 break-all rounded-xl bg-muted px-3 py-2 text-[11px] font-mono text-foreground">
              {previewUrl}
            </p>
          </Field>

          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as BookingPageStatus)}
              className={inputCls()}
            >
              {BOOKING_PAGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {BOOKING_PAGE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {status === "draft" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Página em rascunho não aceita agendamentos.
              </p>
            )}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Duração (min)" error={errors.duration}>
              <input
                type="number"
                min={5}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className={inputCls(errors.duration)}
              />
            </Field>
            <Field label="Buffer entre (min)" error={errors.buffer}>
              <input
                type="number"
                min={0}
                max={1440}
                value={buffer}
                onChange={(e) => setBuffer(Number(e.target.value))}
                className={inputCls(errors.buffer)}
              />
            </Field>
            <Field label="Janela (dias)" error={errors.lookahead}>
              <input
                type="number"
                min={1}
                max={365}
                value={lookahead}
                onChange={(e) => setLookahead(Number(e.target.value))}
                className={inputCls(errors.lookahead)}
              />
            </Field>
          </div>

          {services.length > 0 && (
            <Field label="Serviço (opcional — preenche duração)">
              <select
                value={serviceId ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setServiceId(id);
                  if (id) {
                    const svc = services.find((s) => s.id === id);
                    if (svc) setDuration(svc.duration_minutes);
                  }
                }}
                className={inputCls()}
              >
                <option value="">— Sem serviço —</option>
                {services
                  .filter((s) => s.is_active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration_minutes} min)
                    </option>
                  ))}
              </select>
            </Field>
          )}

          <Field label="Descrição (opcional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Mostrada na página pública pro lead..."
              className={inputCls()}
            />
          </Field>

          {error && (
            <div className="rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive ring-1 ring-destructive/30">
              {error}
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground transition hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !isValid}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white shadow-md shadow-primary/20 transition hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CalendarPlus size={14} />
            )}
            {submitting ? "Salvando..." : isEdit ? "Salvar" : "Criar página"}
          </button>
        </footer>
      </aside>
    </div>
  );
};

const inputCls = (error?: string) =>
  `w-full rounded-xl border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
    error
      ? "border-destructive/50 focus:ring-destructive/30"
      : "border-border focus:ring-primary/30"
  }`;

interface FieldProps {
  label: string;
  error?: string;
  children: React.ReactNode;
}
const Field: React.FC<FieldProps> = ({ label, error, children }) => (
  <div>
    <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-muted-foreground">
      {label}
    </label>
    {children}
    {error && (
      <p className="mt-1 text-[11px] font-semibold text-destructive">{error}</p>
    )}
  </div>
);
