"use client";

import * as React from "react";
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
import { Spinner } from "@persia/ui/spinner";

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
  };
  onSubmit: (formData: FormData) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
};

export function LeadForm({
  defaultValues,
  onSubmit,
  onCancel,
  submitLabel = "Salvar",
}: LeadFormProps) {
  const [isPending, startTransition] = React.useTransition();
  const [source, setSource] = React.useState(defaultValues?.source ?? "manual");
  const [status, setStatus] = React.useState(defaultValues?.status ?? "new");
  const [channel, setChannel] = React.useState(defaultValues?.channel ?? "whatsapp");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function validateField(field: string, value: string, rules: { required?: boolean; email?: boolean }) {
    if (rules.required && !value.trim()) { setError(field, "Campo obrigatório"); return false; }
    if (rules.email && value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setError(field, "Email inválido"); return false; }
    clearError(field);
    return true;
  }

  function validateAll(formData: FormData): boolean {
    const name = formData.get("name") as string || "";
    const phone = formData.get("phone") as string || "";
    const email = formData.get("email") as string || "";
    let valid = true;

    if (!name.trim()) { setError("name", "Campo obrigatório"); valid = false; } else { clearError("name"); }
    if (!phone.trim() && !email.trim()) {
      setError("phone", "Informe telefone ou email");
      setError("email", "Informe telefone ou email");
      valid = false;
    } else {
      if (!errors.phone || errors.phone === "Informe telefone ou email") clearError("phone");
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("email", "Email inválido"); valid = false; } else if (!errors.email || errors.email === "Informe telefone ou email") { clearError("email"); }
    }
    return valid;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("source", source);
    formData.set("status", status);
    formData.set("channel", channel);

    if (!validateAll(formData)) return;

    startTransition(async () => {
      await onSubmit(formData);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Nome *</Label>
        <Input
          id="name"
          name="name"
          placeholder="Nome do lead"
          defaultValue={defaultValues?.name ?? ""}
          onBlur={(e) => validateField("name", e.target.value, { required: true })}
          onChange={() => clearError("name")}
          className={errors.name ? "border-destructive/40" : ""}
        />
        {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="phone">Telefone *</Label>
        <Input
          id="phone"
          name="phone"
          placeholder="(11) 99999-9999"
          defaultValue={defaultValues?.phone ?? ""}
          onChange={() => { clearError("phone"); clearError("email"); }}
          className={errors.phone ? "border-destructive/40" : ""}
        />
        {errors.phone && <p className="text-xs text-destructive mt-1">{errors.phone}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">E-mail *</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="email@exemplo.com"
          defaultValue={defaultValues?.email ?? ""}
          onBlur={(e) => validateField("email", e.target.value, { email: true })}
          onChange={() => { clearError("email"); clearError("phone"); }}
          className={errors.email ? "border-destructive/40" : ""}
        />
        {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
      </div>

      <div className="grid gap-2">
        <Label>Origem</Label>
        <Select value={source} onValueChange={(v) => setSource(v ?? "whatsapp")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione a origem" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v ?? "new")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione o status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Canal</Label>
        <Select value={channel} onValueChange={(v) => setChannel(v ?? "whatsapp")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione o canal" />
          </SelectTrigger>
          <SelectContent>
            {CHANNEL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
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
