"use client";

import * as React from "react";
import { ArrowLeft, CalendarCheck, Loader2 } from "lucide-react";
import { formatTimeRange } from "@persia/shared/agenda";
import {
  type BookingConfirmation,
  submitPublicBooking,
} from "@/actions/agenda/public";

interface PublicLeadFormProps {
  pageId: string;
  selectedStartLocal: string; // "YYYY-MM-DDTHH:mm"
  selectedStartUtc: string;
  selectedEndUtc: string;
  timezone: string;
  onBack: () => void;
  onSuccess: (confirmation: BookingConfirmation) => void;
}

export const PublicLeadForm: React.FC<PublicLeadFormProps> = ({
  pageId,
  selectedStartLocal,
  selectedStartUtc,
  selectedEndUtc,
  timezone,
  onBack,
  onSuccess,
}) => {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const errors = React.useMemo(() => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = "Nome obrigatório (mín. 2 caracteres)";
    if (!/^\+?[\d\s().-]{8,20}$/.test(phone.trim()))
      e.phone = "Telefone inválido";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      e.email = "Email inválido";
    return e;
  }, [name, phone, email]);

  const isValid = Object.keys(errors).length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitPublicBooking({
        page_id: pageId,
        start_local: selectedStartLocal,
        timezone,
        lead_name: name.trim(),
        lead_phone: phone.trim(),
        lead_email: email.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao agendar");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        disabled={submitting}
        className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground transition hover:text-primary"
      >
        <ArrowLeft size={12} />
        Voltar
      </button>

      <div className="rounded-2xl bg-primary/10 p-4 ring-1 ring-primary/30">
        <p className="text-[10px] font-black uppercase tracking-widest text-primary">
          Horário escolhido
        </p>
        <p className="mt-1 text-sm font-bold text-primary">
          {formatTimeRange(selectedStartUtc, selectedEndUtc, timezone)}
        </p>
      </div>

      <Field label="Seu nome" error={errors.name}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          autoComplete="name"
          className={inputCls(errors.name)}
        />
      </Field>

      <Field label="WhatsApp / telefone" error={errors.phone}>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+55 11 99999-9999"
          autoComplete="tel"
          className={inputCls(errors.phone)}
        />
      </Field>

      <Field label="Email (opcional)" error={errors.email}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className={inputCls(errors.email)}
        />
      </Field>

      <Field label="Observações (opcional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Algum contexto que ajude a preparar o atendimento..."
          className={inputCls()}
        />
      </Field>

      {error && (
        <div className="rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive ring-1 ring-destructive/30">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !isValid}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black uppercase tracking-widest text-white shadow-md shadow-primary/20 transition hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <CalendarCheck size={16} />
        )}
        {submitting ? "Confirmando..." : "Confirmar agendamento"}
      </button>
    </form>
  );
};

const inputCls = (error?: string) =>
  `w-full rounded-xl border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
    error
      ? "border-destructive/50 focus:ring-destructive/30"
      : "border-border focus:ring-primary/30"
  }`;

const Field: React.FC<{
  label: string;
  error?: string;
  children: React.ReactNode;
}> = ({ label, error, children }) => (
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
