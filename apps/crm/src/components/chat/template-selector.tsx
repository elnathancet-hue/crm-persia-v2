"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, FileText, Loader2, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import {
  listApprovedTemplates,
  sendTemplateMessage,
  type ApprovedTemplate,
} from "@/actions/templates";
import type { ParamsSchema, TemplateVariableValues } from "@/lib/whatsapp/template-parser";

interface TemplateSelectorProps {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onSent?: () => void;
}

type Step = "pick" | "fill";

export function TemplateSelector({ open, conversationId, onClose, onSent }: TemplateSelectorProps) {
  const [step, setStep] = useState<Step>("pick");
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([]);
  const [selected, setSelected] = useState<ApprovedTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setSelected(null);
    setLoading(true);
    listApprovedTemplates()
      .then((r) => setTemplates(r))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return templates;
    const q = search.toLowerCase();
    return templates.filter((t) => t.name.toLowerCase().includes(q));
  }, [templates, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl max-w-lg w-full mx-4 animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          {step === "fill" && (
            <button
              onClick={() => setStep("pick")}
              className="size-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Voltar"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <FileText className="size-5 text-primary" />
          <h2 className="text-base font-semibold text-foreground flex-1">
            {step === "pick" ? "Escolher template" : selected?.name}
          </h2>
          <button
            onClick={onClose}
            className="size-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        {step === "pick" ? (
          <PickStep
            loading={loading}
            filtered={filtered}
            search={search}
            setSearch={setSearch}
            onPick={(t) => {
              setSelected(t);
              // Skip step "fill" se nao houver params
              if (!hasAnyParam(t.params_schema)) {
                void sendDirect(conversationId, t, onSent, onClose);
              } else {
                setStep("fill");
              }
            }}
          />
        ) : selected ? (
          <FillStep
            template={selected}
            conversationId={conversationId}
            onSent={() => {
              onSent?.();
              onClose();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

// ============ Step 1: pick ============

function PickStep({
  loading,
  filtered,
  search,
  setSearch,
  onPick,
}: {
  loading: boolean;
  filtered: ApprovedTemplate[];
  search: string;
  setSearch: (s: string) => void;
  onPick: (t: ApprovedTemplate) => void;
}) {
  return (
    <>
      <div className="px-5 py-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar template..."
            className="w-full pl-9 pr-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground/60" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            {search ? "Nenhum template encontrado" : "Nenhum template aprovado. Sincronize em Configuracoes > Templates."}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => onPick(t)}
                className="w-full text-left bg-muted border border-border rounded-lg p-3 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-mono text-foreground">{t.name}</h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-soft text-success-soft-foreground inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> APPROVED
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t.language} · {t.category}
                </div>
                <p className="text-xs text-foreground/70 mt-2 line-clamp-2 whitespace-pre-wrap">
                  {extractBodyText(t.components) || <i>(sem body)</i>}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ============ Step 2: fill + send ============

function FillStep({
  template,
  conversationId,
  onSent,
}: {
  template: ApprovedTemplate;
  conversationId: string;
  onSent: () => void;
}) {
  const schema = template.params_schema;
  const [headerVals, setHeaderVals] = useState<Record<string, string>>({});
  const [bodyVals, setBodyVals] = useState<Record<string, string>>({});
  const [buttonVals, setButtonVals] = useState<Record<number, Record<string, string>>>({});
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    try {
      const variables = toVariableValues(schema, headerVals, bodyVals, buttonVals);
      const r = await sendTemplateMessage({
        conversationId,
        templateId: template.id,
        variables,
      });
      if (r.ok) {
        toast.success("Template enviado");
        onSent();
      } else {
        toast.error(r.error || "Erro ao enviar template");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setSending(false);
    }
  }

  const bodyText = useMemo(() => extractBodyText(template.components), [template.components]);
  const preview = useMemo(() => renderPreview(bodyText, bodyVals, schema), [bodyText, bodyVals, schema]);

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="text-xs text-muted-foreground">
          Preencha as variaveis do template. Os exemplos da Meta aparecem como placeholder.
        </div>

        {/* HEADER params */}
        {schema.header && schema.header.params.length > 0 && schema.header.format === "TEXT" && (
          <FieldGroup title="Cabecalho">
            {schema.header.params.map((p, i) => (
              <ParamField
                key={`h-${i}`}
                label={paramLabel(p)}
                placeholder={p.example}
                value={headerVals[paramKey(p)] ?? ""}
                onChange={(v) => setHeaderVals((prev) => ({ ...prev, [paramKey(p)]: v }))}
              />
            ))}
          </FieldGroup>
        )}

        {/* Media header (needs media_id ou URL publica) */}
        {schema.header && schema.header.format !== "TEXT" && schema.header.format !== "LOCATION" && (
          <FieldGroup title={`Cabecalho (${schema.header.format})`}>
            <ParamField
              label="URL publica ou media_id"
              placeholder="https://..."
              value={headerVals["__media__"] ?? ""}
              onChange={(v) => setHeaderVals({ __media__: v })}
            />
          </FieldGroup>
        )}

        {/* BODY params */}
        {schema.body && schema.body.params.length > 0 && (
          <FieldGroup title="Corpo">
            {schema.body.params.map((p, i) => (
              <ParamField
                key={`b-${i}`}
                label={paramLabel(p)}
                placeholder={p.example}
                value={bodyVals[paramKey(p)] ?? ""}
                onChange={(v) => setBodyVals((prev) => ({ ...prev, [paramKey(p)]: v }))}
              />
            ))}
          </FieldGroup>
        )}

        {/* BUTTONS with dynamic params */}
        {schema.buttons?.filter((b) => b.params.length > 0).map((btn) => (
          <FieldGroup key={`btn-${btn.index}`} title={`Botao: ${btn.text}`}>
            {btn.params.map((p, i) => (
              <ParamField
                key={`btn-${btn.index}-${i}`}
                label={paramLabel(p)}
                placeholder={p.example}
                value={buttonVals[btn.index]?.[paramKey(p)] ?? ""}
                onChange={(v) =>
                  setButtonVals((prev) => ({
                    ...prev,
                    [btn.index]: { ...(prev[btn.index] ?? {}), [paramKey(p)]: v },
                  }))
                }
              />
            ))}
          </FieldGroup>
        ))}

        {/* Live preview */}
        {bodyText && (
          <div className="bg-muted border border-border rounded-lg p-3">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Preview</div>
            <p className="text-sm text-foreground whitespace-pre-wrap">{preview}</p>
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border flex justify-end">
        <button
          onClick={handleSend}
          disabled={sending}
          className="flex items-center gap-2 px-4 py-2 bg-success hover:bg-success/90 text-success-foreground rounded-xl text-sm disabled:opacity-50 transition-colors"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Enviar template
        </button>
      </div>
    </>
  );
}

// ============ helpers (UI) ============

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ParamField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
      />
    </div>
  );
}

function paramLabel(p: { name?: string; index?: number }): string {
  if (p.name) return p.name;
  if (p.index) return `{{${p.index}}}`;
  return "Valor";
}

function paramKey(p: { name?: string; index?: number }): string {
  return p.name ?? String(p.index ?? 0);
}

function hasAnyParam(schema: ParamsSchema): boolean {
  if (schema.header && schema.header.params.length > 0) return true;
  if (schema.body && schema.body.params.length > 0) return true;
  if (schema.buttons?.some((b) => b.params.length > 0)) return true;
  return false;
}

function extractBodyText(components: unknown): string {
  const comps = (components ?? []) as Array<{ type: string; text?: string }>;
  return comps.find((c) => c.type === "BODY")?.text ?? "";
}

function renderPreview(
  bodyText: string,
  bodyVals: Record<string, string>,
  schema: ParamsSchema,
): string {
  return bodyText.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const direct = bodyVals[key];
    if (direct) return direct;
    // For POSITIONAL, bodyVals é keyed by numeric string
    const idx = Number(key);
    if (Number.isFinite(idx)) return bodyVals[String(idx)] ?? `{{${key}}}`;
    return `{{${key}}}`;
  });
}

// ============ send helpers ============

async function sendDirect(
  conversationId: string,
  t: ApprovedTemplate,
  onSent: (() => void) | undefined,
  onClose: () => void,
) {
  try {
    const r = await sendTemplateMessage({
      conversationId,
      templateId: t.id,
      variables: {},
    });
    if (r.ok) {
      toast.success("Template enviado");
      onSent?.();
      onClose();
    } else {
      toast.error(r.error || "Erro ao enviar template");
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Erro ao enviar");
  }
}

function toVariableValues(
  schema: ParamsSchema,
  headerVals: Record<string, string>,
  bodyVals: Record<string, string>,
  buttonVals: Record<number, Record<string, string>>,
): TemplateVariableValues {
  const out: TemplateVariableValues = {};

  if (schema.format === "NAMED") {
    if (schema.header?.params.length) out.header = headerVals;
    if (schema.body?.params.length) out.body = bodyVals;
  } else if (schema.format === "POSITIONAL") {
    if (schema.header?.params.length) {
      out.header = schema.header.params.map((p) => headerVals[String(p.index ?? 0)] ?? "");
    }
    if (schema.body?.params.length) {
      out.body = schema.body.params.map((p) => bodyVals[String(p.index ?? 0)] ?? "");
    }
  }

  // Media header: single "__media__" string goes as positional[0]
  if (schema.header && schema.header.format !== "TEXT") {
    out.header = [headerVals["__media__"] ?? ""];
  }

  // Buttons with params
  if (schema.buttons) {
    const btnMap: Record<number, string[]> = {};
    for (const btn of schema.buttons) {
      if (btn.params.length === 0) continue;
      btnMap[btn.index] = btn.params.map((p) => buttonVals[btn.index]?.[paramKey(p)] ?? "");
    }
    if (Object.keys(btnMap).length > 0) out.buttons = btnMap;
  }

  return out;
}
