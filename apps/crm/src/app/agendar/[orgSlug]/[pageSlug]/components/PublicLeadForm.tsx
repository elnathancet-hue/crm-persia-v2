"use client";

// PR-G: PublicLeadForm refatorado pra padrao "uso real em agendamento"
// solicitado pelo user.
//
// MUDANCAS vs versao anterior:
//   - Validacao: regex inline (/^\+?[\d\s().-]{8,20}$/) -> schemas Zod
//     centralizados (@persia/shared/validation). Mesma fonte de verdade
//     do server (PR-A LEADFIX). Phone normaliza visualmente pra E.164
//     no blur (nao apenas valida).
//   - Validacao on blur (nao apenas on submit) — UX nao-bloqueante.
//   - Estrutura: campos lineares -> 2 secoes (Quem e voce? + Sobre o que)
//     com headers visuais. Banner de horario escolhido continua no topo.
//   - Honeypot anti-bot: campo "website" invisivel — bots preenchem por
//     reflexo, humanos nao veem. Server action (PR-G server-side) checa
//     e fake-success (nao gera appointment).
//
// SEGURANCA (decisao consciente):
//   - DuplicateLookup foi proposta cortada — booking e PUBLICO; mostrar
//     "Lead X ja existe" vazaria nomes da base pra qualquer um da
//     internet (privacy leak). Lookup desse tipo so faz sentido em
//     forms internos (admin/agente logado).
//   - Captcha visual (Turnstile/HCaptcha) deferido pra PR-H — requer
//     chave externa + UX de teste.
//
// PRESERVADO:
//   - Banner horario escolhido (intencional)
//   - Estilo "uppercase tracking-widest" — visual publico distinto
//     do form interno

import * as React from "react";
import {
  ArrowLeft,
  CalendarCheck,
  Loader2,
  Contact,
  StickyNote,
} from "lucide-react";
import { formatTimeRange } from "@persia/shared/agenda";
import {
  phoneBR,
  emailOptional,
  leadNameSchema,
} from "@persia/shared/validation";
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
  // Honeypot — invisivel pra humanos, bots preenchem por reflexo.
  // Server-side checa e retorna sucesso fake sem criar appointment.
  const [website, setWebsite] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Validacao on blur — usa schemas Zod centralizados. Phone
  // normaliza visualmente pra E.164 (consistencia entre form public
  // e webhook UAZAPI / form interno).
  function validateName(raw: string) {
    const result = leadNameSchema.safeParse(raw);
    if (!result.success) {
      setErrors((prev) => ({
        ...prev,
        name: result.error.issues[0]?.message ?? "Nome obrigatório",
      }));
      return false;
    }
    setErrors((prev) => {
      const n = { ...prev };
      delete n.name;
      return n;
    });
    return true;
  }

  function validatePhone(raw: string) {
    const result = phoneBR.safeParse(raw);
    if (!result.success) {
      setErrors((prev) => ({
        ...prev,
        phone: result.error.issues[0]?.message ?? "Telefone inválido",
      }));
      return false;
    }
    // Normaliza visualmente — user ve o formato consistente
    if (result.data !== raw) setPhone(result.data);
    setErrors((prev) => {
      const n = { ...prev };
      delete n.phone;
      return n;
    });
    return true;
  }

  function validateEmail(raw: string) {
    if (!raw.trim()) {
      // Email opcional — vazio nao e erro
      setErrors((prev) => {
        const n = { ...prev };
        delete n.email;
        return n;
      });
      return true;
    }
    const result = emailOptional.safeParse(raw);
    if (!result.success) {
      setErrors((prev) => ({
        ...prev,
        email: result.error.issues[0]?.message ?? "Email inválido",
      }));
      return false;
    }
    if (result.data && result.data !== raw) setEmail(result.data);
    setErrors((prev) => {
      const n = { ...prev };
      delete n.email;
      return n;
    });
    return true;
  }

  function validateAll(): boolean {
    const ok1 = validateName(name);
    const ok2 = validatePhone(phone);
    const ok3 = validateEmail(email);
    return ok1 && ok2 && ok3;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll()) return;

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
        // Honeypot — server-side checa
        honeypot: website,
      });
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao agendar");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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

      {/* ============ SECAO 1: QUEM E VOCE? ============ */}
      <SectionHeader
        icon={<Contact size={14} />}
        title="Quem é você?"
        description="Pra confirmar o agendamento e entrar em contato"
      />

      <Field
        label="Seu nome"
        error={errors.name}
      >
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) {
              setErrors((prev) => {
                const n = { ...prev };
                delete n.name;
                return n;
              });
            }
          }}
          onBlur={(e) => {
            if (e.target.value.trim()) validateName(e.target.value);
          }}
          autoFocus
          autoComplete="name"
          aria-invalid={!!errors.name}
          className={inputCls(errors.name)}
        />
      </Field>

      <Field
        label="WhatsApp / telefone"
        error={errors.phone}
      >
        <input
          type="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (errors.phone) {
              setErrors((prev) => {
                const n = { ...prev };
                delete n.phone;
                return n;
              });
            }
          }}
          onBlur={(e) => {
            if (e.target.value.trim()) validatePhone(e.target.value);
          }}
          placeholder="(11) 98765-4321"
          autoComplete="tel"
          aria-invalid={!!errors.phone}
          className={inputCls(errors.phone)}
        />
      </Field>

      <Field
        label="Email (opcional)"
        error={errors.email}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) {
              setErrors((prev) => {
                const n = { ...prev };
                delete n.email;
                return n;
              });
            }
          }}
          onBlur={(e) => validateEmail(e.target.value)}
          autoComplete="email"
          aria-invalid={!!errors.email}
          className={inputCls(errors.email)}
        />
      </Field>

      {/* ============ SECAO 2: SOBRE O QUE? ============ */}
      <SectionHeader
        icon={<StickyNote size={14} />}
        title="Sobre o que?"
        description="Contexto pra preparar o atendimento (opcional)"
      />

      <Field label="Observações">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
          rows={3}
          maxLength={1000}
          placeholder="Conte um pouco do que você precisa..."
          className={inputCls() + " resize-none"}
        />
        <p className="mt-1 text-right text-[10px] text-muted-foreground/70">
          {notes.length}/1000
        </p>
      </Field>

      {/* HONEYPOT: invisivel pra humanos (CSS + tabIndex + aria-hidden).
          Bots scrapers preenchem por reflexo. Server-side checa e
          retorna sucesso fake. Campo nome "website" pq bots tendem a
          preencher campos com nomes "obvios". */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-10000px",
          top: "auto",
          width: "1px",
          height: "1px",
          overflow: "hidden",
        }}
      >
        <label htmlFor="website-confirm">Website (deixe em branco)</label>
        <input
          id="website-confirm"
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive ring-1 ring-destructive/30"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
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

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
}> = ({ icon, title, description }) => (
  <header className="space-y-0.5 pt-1">
    <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-foreground">
      <span className="text-primary">{icon}</span>
      {title}
    </h3>
    {description && (
      <p className="text-[11px] text-muted-foreground pl-5">{description}</p>
    )}
  </header>
);

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
