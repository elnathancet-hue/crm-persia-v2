"use client";

// PR-F: LeadForm refatorado em 3 secoes (Identificacao, Origem & Status,
// Notas) com validacao Zod inline pra atendimento comercial real.
//
// MUDANCAS vs versao anterior:
//   - Estrutura: campos soltos -> 3 secoes com headers visuais (icone +
//     label uppercase + descricao curta). UX consistente com forms premium
//     (Linear/Notion) e DesignFlow Kit.
//   - Validacao: regex inline -> schemas Zod centralizados em
//     @persia/shared/validation (phoneBR pra E.164, emailOptional, regra
//     "phone OU email obrigatorio" via leadCreateSchema).
//   - Phone: input agora normaliza pra E.164 no blur (formato BR padrao)
//     e mostra erro PT-BR acentuado vindo do schema.
//   - Notas: campo novo (textarea max 2000 chars) — agente captura
//     contexto adicional do lead direto na criacao/edicao.
//
// API: preserva contrato existente (defaultValues + onSubmit + onCancel +
// submitLabel). Callers nao precisam mudar — apenas se beneficiam do form
// novo automaticamente.

import * as React from "react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { Spinner } from "@persia/ui/spinner";
import {
  Contact,
  Filter,
  StickyNote,
  AlertCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import {
  phoneBROptional,
  emailOptional,
  leadCreateSchema,
} from "@persia/shared/validation";
import { useLeadsActions } from "../context";

const STATUS_OPTIONS = [
  { value: "new", label: "Novo" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Qualificado" },
  { value: "customer", label: "Cliente" },
  { value: "lost", label: "Perdido" },
];

const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "indicacao", label: "Indicação" },
  { value: "outro", label: "Outro" },
];

const CHANNEL_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Telefone" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "outro", label: "Outro" },
];

type LeadFormProps = {
  defaultValues?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    source?: string;
    status?: string;
    channel?: string;
    notes?: string | null;
  };
  onSubmit: (formData: FormData) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  /**
   * PR-L5: callback quando lookup detecta lead duplicado e user
   * clica "Reutilizar". Caller (LeadList) abre drawer do lead
   * existente. Opcional — sem callback, apenas o botao "Criar
   * mesmo assim" funciona (banner mostra info mas nao conecta).
   */
  onDuplicateFound?: (lead: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
  }) => void;
};

export function LeadForm({
  defaultValues,
  onSubmit,
  onCancel,
  submitLabel = "Salvar",
  onDuplicateFound,
}: LeadFormProps) {
  // PR-L5: action injetada via context. findDuplicate e opcional —
  // se nao foi injetada (admin compat), banner nao aparece.
  const actions = useLeadsActions();

  const [isPending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(defaultValues?.name ?? "");
  const [phone, setPhone] = React.useState(defaultValues?.phone ?? "");
  const [email, setEmail] = React.useState(defaultValues?.email ?? "");
  const [source, setSource] = React.useState(defaultValues?.source ?? "manual");
  const [status, setStatus] = React.useState(defaultValues?.status ?? "new");
  const [channel, setChannel] = React.useState(
    defaultValues?.channel ?? "whatsapp",
  );
  const [notes, setNotes] = React.useState(defaultValues?.notes ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // PR-L5: state pra lookup de duplicidade
  const [duplicateMatch, setDuplicateMatch] = React.useState<{
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    matched_by: "phone" | "email";
  } | null>(null);
  const [duplicateChecking, setDuplicateChecking] = React.useState(false);
  const [duplicateDismissed, setDuplicateDismissed] = React.useState(false);
  const lookupCancelRef = React.useRef<{ cancelled: boolean } | null>(null);

  // Lookup async on blur (phone OR email). Re-checa apenas quando
  // user dismissou anteriormente nao retorna ate proximo blur com
  // valor diferente (evita banner persistente).
  const checkDuplicate = React.useCallback(
    async (currentPhone: string, currentEmail: string) => {
      // Edicao de lead existente: nao precisa lookup
      if (defaultValues?.phone || defaultValues?.email) return;
      // Action nao injetada (admin compat): skip
      if (!actions.findDuplicate) return;
      // Ambos vazios: skip
      if (!currentPhone.trim() && !currentEmail.trim()) {
        setDuplicateMatch(null);
        return;
      }

      // Cancela lookup anterior em voo
      if (lookupCancelRef.current) lookupCancelRef.current.cancelled = true;
      const cancelToken = { cancelled: false };
      lookupCancelRef.current = cancelToken;

      setDuplicateChecking(true);
      try {
        const match = await actions.findDuplicate(
          currentPhone.trim() || null,
          currentEmail.trim() || null,
        );
        if (cancelToken.cancelled) return;
        // Reset dismissed se voltou a achar (ou achou outro lead diferente)
        if (match && match.id !== duplicateMatch?.id) {
          setDuplicateDismissed(false);
        }
        setDuplicateMatch(match);
      } catch {
        // Falha silenciosa — banner nao aparece, fluxo continua
        if (!cancelToken.cancelled) setDuplicateMatch(null);
      } finally {
        if (!cancelToken.cancelled) setDuplicateChecking(false);
      }
    },
    [actions, defaultValues?.phone, defaultValues?.email, duplicateMatch?.id],
  );

  // Validacao por campo on blur (UX ideal pra forms — nao interrompe
  // digitacao). Phone normaliza pra E.164 e atualiza state com valor
  // formatado pro user enxergar.
  function validatePhone(raw: string) {
    const result = phoneBROptional.safeParse(raw);
    if (!result.success) {
      setErrors((prev) => ({
        ...prev,
        phone: result.error.issues[0]?.message ?? "Telefone inválido",
      }));
      return false;
    }
    // Normaliza visualmente — agente ve formato consistente
    if (result.data && result.data !== raw) {
      setPhone(result.data);
    }
    setErrors((prev) => {
      const n = { ...prev };
      delete n.phone;
      return n;
    });
    return true;
  }

  function validateEmail(raw: string) {
    const result = emailOptional.safeParse(raw);
    if (!result.success) {
      setErrors((prev) => ({
        ...prev,
        email: result.error.issues[0]?.message ?? "Email inválido",
      }));
      return false;
    }
    if (result.data && result.data !== raw) {
      setEmail(result.data);
    }
    setErrors((prev) => {
      const n = { ...prev };
      delete n.email;
      return n;
    });
    return true;
  }

  // Validacao final no submit usando o schema composto (regra
  // "phone OU email obrigatorio" centralizada).
  function validateAll(): boolean {
    const result = leadCreateSchema.safeParse({
      name,
      phone,
      email,
      source,
      status,
      channel,
      notes,
    });
    if (!result.success) {
      const newErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && !newErrors[field]) {
          newErrors[field] = issue.message;
        }
      }
      setErrors(newErrors);
      return false;
    }
    setErrors({});
    return true;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validateAll()) return;

    const formData = new FormData();
    if (name.trim()) formData.set("name", name.trim());
    if (phone.trim()) formData.set("phone", phone.trim());
    if (email.trim()) formData.set("email", email.trim());
    formData.set("source", source);
    formData.set("status", status);
    formData.set("channel", channel);
    if (notes.trim()) formData.set("notes", notes.trim());

    startTransition(async () => {
      await onSubmit(formData);
    });
  }

  const notesLength = notes.length;
  const notesNearLimit = notesLength > 1800;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ============ SECAO 1: IDENTIFICACAO ============ */}
      <FormSection
        icon={<Contact className="size-4 text-muted-foreground" />}
        title="Identificação"
        description="Pelo menos telefone ou email é obrigatório"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nome" htmlFor="name">
            <Input
              id="name"
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
              placeholder="Nome do lead"
              aria-invalid={!!errors.name}
              className={errors.name ? "border-destructive/40" : ""}
            />
            {errors.name && (
              <p className="text-xs text-destructive mt-1">{errors.name}</p>
            )}
          </Field>

          <Field label="Telefone" htmlFor="phone">
            <Input
              id="phone"
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
                // PR-L5: dispara lookup de duplicidade on blur
                checkDuplicate(e.target.value, email);
              }}
              placeholder="(11) 98765-4321"
              aria-invalid={!!errors.phone}
              className={errors.phone ? "border-destructive/40" : ""}
            />
            {errors.phone && (
              <p className="text-xs text-destructive mt-1">{errors.phone}</p>
            )}
          </Field>

          <Field label="E-mail" htmlFor="email" className="sm:col-span-2">
            <Input
              id="email"
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
              onBlur={(e) => {
                if (e.target.value.trim()) validateEmail(e.target.value);
                // PR-L5: dispara lookup de duplicidade on blur
                checkDuplicate(phone, e.target.value);
              }}
              placeholder="email@exemplo.com"
              aria-invalid={!!errors.email}
              className={errors.email ? "border-destructive/40" : ""}
            />
            {errors.email && (
              <p className="text-xs text-destructive mt-1">{errors.email}</p>
            )}
          </Field>
        </div>

        {/* PR-L5: Banner de duplicidade — aparece quando lookup achou
            lead existente. User pode "Reutilizar" (callback abre drawer
            do existente) ou "Criar mesmo assim" (dismissa banner).
            Indicador de loading subtle ao lado do label se checking. */}
        {duplicateChecking && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Verificando duplicatas...
          </p>
        )}
        {duplicateMatch && !duplicateDismissed && (
          <div className="rounded-lg border border-warning-ring bg-warning-soft p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="size-4 shrink-0 text-warning mt-0.5" />
              <div className="flex-1 min-w-0 space-y-2">
                <div>
                  <p className="text-sm font-semibold text-warning-soft-foreground">
                    Lead já existe nesta organização
                  </p>
                  <p className="text-xs text-warning-soft-foreground/80 mt-0.5">
                    <strong className="font-semibold">
                      {duplicateMatch.name?.trim() || "Sem nome"}
                    </strong>
                    {" — "}
                    {duplicateMatch.matched_by === "phone"
                      ? `mesmo telefone (${duplicateMatch.phone ?? "—"})`
                      : `mesmo email (${duplicateMatch.email ?? "—"})`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {onDuplicateFound && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-7 rounded-md gap-1.5 text-xs bg-warning text-warning-foreground hover:bg-warning/90"
                      onClick={() => onDuplicateFound(duplicateMatch)}
                    >
                      <ExternalLink className="size-3" />
                      Abrir lead existente
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md text-xs border-warning-ring text-warning-soft-foreground hover:bg-warning-soft/70"
                    onClick={() => setDuplicateDismissed(true)}
                  >
                    Criar mesmo assim
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </FormSection>

      {/* ============ SECAO 2: ORIGEM & STATUS ============ */}
      <FormSection
        icon={<Filter className="size-4 text-muted-foreground" />}
        title="Origem & Status"
        description="Como o lead chegou e em que momento da jornada está"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Origem">
            <Select
              value={source}
              onValueChange={(v) => v && setSource(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {SOURCE_OPTIONS.find((o) => o.value === source)?.label ??
                    "Selecione"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Status">
            <Select
              value={status}
              onValueChange={(v) => v && setStatus(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {STATUS_OPTIONS.find((o) => o.value === status)?.label ??
                    "Selecione"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Canal preferido">
            <Select
              value={channel}
              onValueChange={(v) => v && setChannel(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {CHANNEL_OPTIONS.find((o) => o.value === channel)?.label ??
                    "Selecione"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FormSection>

      {/* ============ SECAO 3: NOTAS INTERNAS ============ */}
      <FormSection
        icon={<StickyNote className="size-4 text-muted-foreground" />}
        title="Notas internas"
        description="Contexto adicional pra equipe (não visível pro lead)"
      >
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
          placeholder="Ex: indicado por João Silva. Quer reunião na próxima semana."
          rows={4}
          maxLength={2000}
          className="resize-none"
        />
        <p
          className={`mt-1 text-right text-[11px] ${
            notesNearLimit ? "text-warning" : "text-muted-foreground"
          }`}
        >
          {notesLength}/2000 caracteres
        </p>
      </FormSection>

      {/* ============ FOOTER ============ */}
      <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending && <Spinner className="mr-1.5" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

// Helper local — Section wrapper com header visual (ícone + título +
// descrição). Mantém estilo consistente entre as 3 seções.
function FormSection({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="space-y-0.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </h3>
        {description && (
          <p className="text-xs text-muted-foreground pl-6">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}

// Helper local — Field padroniza Label + child. Suporta htmlFor pra
// acessibilidade.
function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className ? `space-y-1 ${className}` : "space-y-1"}>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
