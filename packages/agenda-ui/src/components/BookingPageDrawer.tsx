"use client";

import * as React from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import {
  type AgendaService,
  type BookingPage,
  type BookingPageStatus,
  BOOKING_PAGE_STATUSES,
  BOOKING_PAGE_STATUS_LABELS,
} from "@persia/shared/agenda";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
import { Textarea } from "@persia/ui/textarea";
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
const NO_SERVICE = "__none__";

function slugifyDraft(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!slugTouched && !isEdit) {
      setSlug(slugifyDraft(v));
    }
  };

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

  const dialogTitle = isEdit ? "Editar página" : "Nova página de agendamento";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border bg-card p-5">
          <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
          <DialogHero
            icon={<CalendarPlus className="size-5" />}
            title={dialogTitle}
            tagline="Link público pra leads agendarem sozinhos"
          />
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="space-y-1.5">
            <Label htmlFor="bp-title">Título</Label>
            <Input
              id="bp-title"
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Ex: Consulta inicial"
              aria-invalid={Boolean(errors.title)}
            />
            {errors.title && (
              <p className="text-xs text-destructive">{errors.title}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bp-slug">Slug (URL)</Label>
            <Input
              id="bp-slug"
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase());
                setSlugTouched(true);
              }}
              placeholder="consulta-inicial"
              aria-invalid={Boolean(errors.slug)}
            />
            {errors.slug && (
              <p className="text-xs text-destructive">{errors.slug}</p>
            )}
            <p className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
              {previewUrl}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bp-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) =>
                v && setStatus(v as BookingPageStatus)
              }
            >
              <SelectTrigger id="bp-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOOKING_PAGE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {BOOKING_PAGE_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {status === "draft" && (
              <p className="text-xs text-muted-foreground">
                Página em rascunho não aceita agendamentos.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="bp-duration">Duração (min)</Label>
              <Input
                id="bp-duration"
                type="number"
                min={5}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                aria-invalid={Boolean(errors.duration)}
              />
              {errors.duration && (
                <p className="text-xs text-destructive">{errors.duration}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-buffer">Buffer (min)</Label>
              <Input
                id="bp-buffer"
                type="number"
                min={0}
                max={1440}
                value={buffer}
                onChange={(e) => setBuffer(Number(e.target.value))}
                aria-invalid={Boolean(errors.buffer)}
              />
              {errors.buffer && (
                <p className="text-xs text-destructive">{errors.buffer}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-lookahead">Janela (dias)</Label>
              <Input
                id="bp-lookahead"
                type="number"
                min={1}
                max={365}
                value={lookahead}
                onChange={(e) => setLookahead(Number(e.target.value))}
                aria-invalid={Boolean(errors.lookahead)}
              />
              {errors.lookahead && (
                <p className="text-xs text-destructive">{errors.lookahead}</p>
              )}
            </div>
          </div>

          {services.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="bp-service">
                Serviço{" "}
                <span className="text-muted-foreground">
                  (preenche duração)
                </span>
              </Label>
              <Select
                value={serviceId ?? NO_SERVICE}
                onValueChange={(v) => {
                  if (!v || v === NO_SERVICE) {
                    setServiceId(null);
                    return;
                  }
                  setServiceId(v);
                  const svc = services.find((s) => s.id === v);
                  if (svc) setDuration(svc.duration_minutes);
                }}
              >
                <SelectTrigger id="bp-service" className="w-full">
                  <SelectValue placeholder="— Sem serviço —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SERVICE}>— Sem serviço —</SelectItem>
                  {services
                    .filter((s) => s.is_active)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.duration_minutes} min)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="bp-description">Descrição (opcional)</Label>
            <Textarea
              id="bp-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Mostrada na página pública pro lead..."
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/30">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border bg-card p-4 flex-row justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !isValid}
          >
            {submitting ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
            {submitting ? "Salvando..." : isEdit ? "Salvar" : "Criar página"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
