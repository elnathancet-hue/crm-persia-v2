"use client";

import { useState } from "react";
import { Loader2, CheckCircle, Copy, ExternalLink, ShieldCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { connectMetaCloudWhatsApp, type MetaConnectResult } from "@/actions/whatsapp-manage";

interface FormState {
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  phone_number: string;
  display_name: string;
}

const INITIAL: FormState = {
  phone_number_id: "",
  waba_id: "",
  access_token: "",
  phone_number: "",
  display_name: "",
};

export function MetaConnectForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<MetaConnectResult | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copiado`),
      () => toast.error("Nao foi possivel copiar"),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await connectMetaCloudWhatsApp({
        phone_number_id: form.phone_number_id,
        waba_id: form.waba_id,
        access_token: form.access_token,
        phone_number: form.phone_number,
        display_name: form.display_name || undefined,
      });
      setResult(r);
      if (r.status === "connected") {
        toast.success("Conexao Meta Cloud validada e salva");
      } else {
        toast.error(r.error || "Falha ao conectar Meta Cloud");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.status === "connected") {
    return (
      <div className="space-y-4">
        <div className="bg-emerald-500/10 border border-border rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-2xl flex items-center justify-center bg-emerald-500/10 border border-border">
              <CheckCircle className="size-6 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-emerald-400">Meta Cloud conectado</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {result.displayPhoneNumber
                  ? `Numero oficial: ${result.displayPhoneNumber}`
                  : "Token validado."}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="size-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-foreground">Configure o webhook na Meta</h4>
              <p className="text-xs text-muted-foreground mt-1">
                No painel do seu App em{" "}
                <a
                  href="https://developers.facebook.com/apps"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary inline-flex items-center gap-1 hover:underline"
                >
                  developers.facebook.com <ExternalLink className="size-3" />
                </a>
                , va em WhatsApp &gt; Configuracao e cole os valores abaixo.
              </p>
            </div>
          </div>

          <CopyField
            label="Callback URL"
            value={result.webhookUrl ?? ""}
            onCopy={(v) => copyToClipboard(v, "Callback URL")}
            monospaceClass="text-xs"
          />
          <CopyField
            label="Verify Token"
            value={result.webhookVerifyToken ?? ""}
            onCopy={(v) => copyToClipboard(v, "Verify Token")}
            monospaceClass="text-xs"
          />

          <div className="text-xs text-muted-foreground pt-2 border-t border-border">
            Apos colar e clicar em <strong className="text-foreground">Verify and Save</strong> na Meta,
            inscreva-se nos campos <code className="text-foreground">messages</code> e{" "}
            <code className="text-foreground">message_template_status_update</code>.
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setResult(null);
            setForm(INITIAL);
          }}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Conectar outro numero
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
        <AlertCircle className="size-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground">
          Precisa ter um <strong className="text-foreground">App Meta</strong> com produto WhatsApp,
          um <strong className="text-foreground">numero adicionado ao WABA</strong>, e um{" "}
          <strong className="text-foreground">System User token permanente</strong>. Encontre os
          valores em Meta Business Manager &gt; WhatsApp &gt; API Setup.
        </div>
      </div>

      <Field
        label="Phone Number ID"
        placeholder="Ex: 123456789012345"
        value={form.phone_number_id}
        onChange={(v) => setField("phone_number_id", v)}
        required
      />
      <Field
        label="WhatsApp Business Account (WABA) ID"
        placeholder="Ex: 987654321098765"
        value={form.waba_id}
        onChange={(v) => setField("waba_id", v)}
        required
      />
      <Field
        label="Access Token permanente"
        placeholder="EAAG... (permanente, nao o de debug)"
        value={form.access_token}
        onChange={(v) => setField("access_token", v)}
        required
        sensitive
      />
      <Field
        label="Numero em E.164"
        placeholder="+5511999998888"
        value={form.phone_number}
        onChange={(v) => setField("phone_number", v)}
        required
      />
      <Field
        label="Display name (opcional)"
        placeholder="Nome exibido no WhatsApp"
        value={form.display_name}
        onChange={(v) => setField("display_name", v)}
      />

      {result?.error && (
        <div className="bg-red-500/10 border border-border rounded-xl p-3 text-xs text-red-400 flex items-start gap-2">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          {result.error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm disabled:opacity-50 transition-colors"
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          Validar e Conectar
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  sensitive,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  sensitive?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={sensitive ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none transition-colors"
      />
    </div>
  );
}

function CopyField({
  label,
  value,
  onCopy,
  monospaceClass,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
  monospaceClass?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          className={`flex-1 px-3 py-2 bg-muted border border-border rounded-lg font-mono text-foreground ${monospaceClass ?? "text-sm"}`}
        />
        <button
          type="button"
          onClick={() => onCopy(value)}
          className="px-3 py-2 bg-card border border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          aria-label={`Copiar ${label}`}
        >
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}
