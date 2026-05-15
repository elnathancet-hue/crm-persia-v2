"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getCampaigns, createCampaign, updateCampaignStatus, deleteCampaign, executeCampaign } from "@/actions/campaigns";
import { listTemplates, type TemplateRow } from "@/actions/templates";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useEscapeKey } from "@/lib/hooks/use-escape-key";
import { FileText, Megaphone, MessageSquare, Plus, Loader2, Trash2, X, Play, Pause, Send } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";
import type { ParamsSchema, TemplateVariableValues } from "@/lib/whatsapp/template-parser";

// PR-COLOR-SWEEP: cores mapeadas pros tokens do DS (admin).
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted-foreground" },
  scheduled: { label: "Agendada", color: "bg-warning" },
  sending: { label: "Enviando", color: "bg-primary" },
  sent: { label: "Enviada", color: "bg-success" },
  paused: { label: "Pausada", color: "bg-failure" },
};

export default function CampaignsPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const focusTrapRef = useFocusTrap(showCreate);
  useEscapeKey(showCreate, useCallback(() => setShowCreate(false), []));

  function load() {
    if (!isManagingClient) return;
    setLoading(true);
    getCampaigns().then((d) => { setCampaigns(d); setLoading(false); });
  }

  useEffect(() => { load(); }, [activeOrgId]);

  async function handleDelete(id: string) {
    if (!confirm("Excluir esta campanha?")) return;
    await deleteCampaign(id);
    toast.success("Campanha excluída");
    load();
  }

  async function handleStatusChange(id: string, status: string) {
    const { error } = await updateCampaignStatus(id, status);
    if (error) {
      toast.error(error);
      return;
    }
    load();
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Campanhas</h1>
          <p className="text-sm text-muted-foreground">{campaigns.length} campanhas</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm">
          <Plus className="size-4" /> Nova Campanha
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Megaphone className="size-12 mx-auto text-muted-foreground/30" />
          <p className="text-lg text-muted-foreground/60">Nenhuma campanha criada</p>
          <p className="text-sm text-muted-foreground/50">Crie sua primeira campanha para enviar mensagens em massa</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Mensagem</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Criado em</th>
                <th className="px-4 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const st = STATUS_LABELS[c.status] || STATUS_LABELS.draft;
                return (
                  <tr key={c.id} className="border-b border-accent">
                    <td className="px-4 py-3 text-sm text-foreground font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell max-w-[200px] truncate">{c.message}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full text-white ${st.color}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground/60 hidden md:table-cell">{new Date(c.created_at).toLocaleDateString("pt-BR")}</td>
                    <td className="px-4 py-3 flex items-center gap-1">
                      {c.status === "draft" && (
                        <button onClick={async () => {
                          if (!confirm("Enviar campanha agora?")) return;
                          const { sent, error } = await executeCampaign(c.id);
                          if (error) toast.error(error);
                          else { toast.success(`Campanha enviada para ${sent} leads`); load(); }
                        }} className="text-success hover:text-success/80 p-1" title="Enviar" aria-label="Enviar campanha"><Send className="size-4" /></button>
                      )}
                      {c.status === "sending" && (
                        <button onClick={() => handleStatusChange(c.id, "paused")} className="text-warning hover:text-warning/80 p-1" title="Pausar" aria-label="Pausar campanha"><Pause className="size-4" /></button>
                      )}
                      {c.status === "paused" && (
                        <button onClick={() => handleStatusChange(c.id, "sending")} className="text-success hover:text-success/80 p-1" title="Retomar" aria-label="Retomar campanha"><Play className="size-4" /></button>
                      )}
                      <button onClick={() => handleDelete(c.id)} aria-label="Excluir campanha" className="text-muted-foreground/60 hover:text-destructive p-1"><Trash2 className="size-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCreate(false)} />
          <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-labelledby="create-campaign-title" className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 id="create-campaign-title" className="text-lg font-semibold text-foreground">Nova Campanha</h2>
              <button onClick={() => setShowCreate(false)} aria-label="Fechar" className="text-muted-foreground/60 hover:text-foreground"><X className="size-5" /></button>
            </div>
            <CampaignForm onCreated={() => { setShowCreate(false); load(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

type CampaignMode = "text" | "template";

function CampaignForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<CampaignMode>("text");
  const [message, setMessage] = useState("");
  const [tags, setTags] = useState("");
  const [interval, setIntervalSec] = useState(30);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Template-mode state
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [headerVals, setHeaderVals] = useState<Record<string, string>>({});
  const [bodyVals, setBodyVals] = useState<Record<string, string>>({});

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );
  const selectedSchema = selectedTemplate?.params_schema as ParamsSchema | undefined;

  useEffect(() => {
    if (mode !== "template" || templates.length > 0) return;
    setTemplatesLoading(true);
    listTemplates({ onlyApproved: true })
      .then((d) => setTemplates(d))
      .finally(() => setTemplatesLoading(false));
  }, [mode, templates.length]);

  function setFieldError(field: string, msg: string) { setErrors(prev => ({ ...prev, [field]: msg })); }
  function clearFieldError(field: string) { setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Campo obrigatório";

    if (mode === "text") {
      if (!message.trim()) newErrors.message = "Campo obrigatório";
      else if (message.trim().length < 10) newErrors.message = "Mínimo 10 caracteres";
    } else {
      if (!selectedTemplateId) newErrors.template = "Escolha um template";
    }

    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setSaving(true);
    const payload =
      mode === "text"
        ? { name, message, target_tags: tags, send_interval_seconds: interval }
        : {
            name,
            templateId: selectedTemplateId,
            variablesTemplate: buildVariables(selectedSchema, headerVals, bodyVals),
            target_tags: tags,
            send_interval_seconds: interval,
          };

    const { error } = await createCampaign(payload);
    if (error) toast.error(error);
    else { toast.success("Campanha criada"); onCreated(); }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Nome *</label>
        <input
          value={name}
          onChange={e => { setName(e.target.value); clearFieldError("name"); }}
          onBlur={() => { if (!name.trim()) setFieldError("name", "Campo obrigatório"); }}
          className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${errors.name ? "border-destructive" : "border-border"}`}
        />
        {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
      </div>

      {/* Tipo: texto vs template */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Tipo de campanha</label>
        <div className="flex gap-2">
          <ModeTab active={mode === "text"} onClick={() => setMode("text")} icon={<MessageSquare className="size-4" />}>
            Texto livre
            <span className="text-[10px] text-muted-foreground ml-1">(UAZAPI)</span>
          </ModeTab>
          <ModeTab active={mode === "template"} onClick={() => setMode("template")} icon={<FileText className="size-4" />}>
            Template oficial
            <span className="text-[10px] text-muted-foreground ml-1">(Meta)</span>
          </ModeTab>
        </div>
      </div>

      {mode === "text" ? (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Mensagem *</label>
          <textarea
            value={message}
            onChange={e => { setMessage(e.target.value); clearFieldError("message"); }}
            onBlur={() => { if (!message.trim()) setFieldError("message", "Campo obrigatório"); else if (message.trim().length < 10) setFieldError("message", "Mínimo 10 caracteres"); }}
            rows={4}
            className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary resize-none ${errors.message ? "border-destructive" : "border-border"}`}
          />
          {errors.message && <p className="text-xs text-destructive mt-1">{errors.message}</p>}
        </div>
      ) : (
        <TemplateSection
          templates={templates}
          loading={templatesLoading}
          selectedId={selectedTemplateId}
          onSelect={(id) => { setSelectedTemplateId(id); setHeaderVals({}); setBodyVals({}); clearFieldError("template"); }}
          selected={selectedTemplate}
          schema={selectedSchema}
          headerVals={headerVals}
          setHeaderVals={setHeaderVals}
          bodyVals={bodyVals}
          setBodyVals={setBodyVals}
          error={errors.template}
        />
      )}

      <div>
        <label className="text-xs text-muted-foreground block mb-1">Tags alvo (separadas por virgula)</label>
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="vip, cliente" className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary" />
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">Intervalo entre envios (segundos)</label>
        <input
          type="number"
          min={1}
          max={300}
          value={interval}
          onChange={e => setIntervalSec(Math.max(1, Number(e.target.value) || 30))}
          className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          {mode === "template"
            ? "A fila do worker envia ~30 por minuto (configuravel no cron). O intervalo e orientacao ao rate; a Meta impoe limites por tier."
            : "UAZAPI usa esse valor como delay minimo; delay maximo = 2x esse valor."}
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="size-4 animate-spin" />}Criar
        </button>
      </div>
    </form>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
        active
          ? "bg-primary/10 border-primary text-primary"
          : "bg-muted border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function TemplateSection({
  templates,
  loading,
  selectedId,
  onSelect,
  selected,
  schema,
  headerVals,
  setHeaderVals,
  bodyVals,
  setBodyVals,
  error,
}: {
  templates: TemplateRow[];
  loading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  selected: TemplateRow | null;
  schema: ParamsSchema | undefined;
  headerVals: Record<string, string>;
  setHeaderVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  bodyVals: Record<string, string>;
  setBodyVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  error?: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Carregando templates...
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="bg-warning-soft border border-warning-ring rounded-lg p-3 text-xs text-warning-soft-foreground">
        Nenhum template APPROVED disponivel. Configure uma conexao Meta Cloud e sincronize em{" "}
        <strong>Configuracoes &gt; Templates</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Template *</label>
        <select
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground outline-none focus:border-primary ${error ? "border-destructive" : "border-border"}`}
        >
          <option value="">Escolha um template...</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.language} · {t.category})
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>

      {selected && schema && (
        <>
          <div className="bg-muted/50 border border-border rounded-lg p-3 text-xs whitespace-pre-wrap text-muted-foreground">
            {extractBody(selected.components) || "(sem body)"}
          </div>

          {schema.header?.params.length && schema.header.format === "TEXT" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Variaveis do cabecalho</p>
              {schema.header.params.map((p, i) => (
                <VarInput
                  key={`h-${i}`}
                  label={paramLabel(p)}
                  placeholder={p.example}
                  value={headerVals[paramKey(p)] ?? ""}
                  onChange={(v) => setHeaderVals((prev) => ({ ...prev, [paramKey(p)]: v }))}
                />
              ))}
            </div>
          ) : null}

          {schema.body?.params.length ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Variaveis do corpo</p>
              {schema.body.params.map((p, i) => (
                <VarInput
                  key={`b-${i}`}
                  label={paramLabel(p)}
                  placeholder={p.example}
                  value={bodyVals[paramKey(p)] ?? ""}
                  onChange={(v) => setBodyVals((prev) => ({ ...prev, [paramKey(p)]: v }))}
                />
              ))}
              <p className="text-[11px] text-muted-foreground">
                Dica: use <code className="text-foreground">{"{{lead.name}}"}</code> ou{" "}
                <code className="text-foreground">{"{{lead.phone}}"}</code> para substituir pelo valor do lead.
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function VarInput({
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
    <div>
      <label className="text-[11px] text-muted-foreground block mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary"
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

function extractBody(components: unknown): string {
  const comps = (components ?? []) as Array<{ type: string; text?: string }>;
  return comps.find((c) => c.type === "BODY")?.text ?? "";
}

function buildVariables(
  schema: ParamsSchema | undefined,
  headerVals: Record<string, string>,
  bodyVals: Record<string, string>,
): TemplateVariableValues {
  if (!schema) return {};
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

  return out;
}
