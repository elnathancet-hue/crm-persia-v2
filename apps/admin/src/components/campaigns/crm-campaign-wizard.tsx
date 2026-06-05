"use client";

// Wizard de criação de campanha — 6 etapas conforme roadmap.
// Etapa 1: Objetivo (tipo) → 2: Público → 3: Mensagem → 4: Agenda → 5: Validação → 6: Confirmar

import { useState, useTransition, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@persia/ui/dialog";
import { Checkbox } from "@persia/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@persia/ui/select";
import {
  MessageSquare, CheckCircle2, AlertCircle, Loader2,
  ChevronRight, ChevronLeft, Upload, Trash2, FileText,
  Megaphone, Users, Send, CalendarClock, ShieldCheck,
  UserCircle, Zap, Save,
} from "lucide-react";
import type {
  CampaignKind, CreateCampaignDraftInput, CampaignAudiencePreview, CrmCampaignWithDetails
} from "@persia/shared/crm";
import {
  createCampaignDraft, updateCampaignDraft, validateCampaign, previewCampaignAudience, scheduleCampaign, uploadCampaignMediaAction,
} from "@/actions/crm-campaigns";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  segments: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  pipelines: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; pipeline_id: string; name: string }>;
  groups: Array<{ id: string; name: string; category: string | null; participant_count: number | null }>;
  initialData?: CrmCampaignWithDetails | null;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const STEP_LABELS: Record<Step, string> = {
  1: "Objetivo",
  2: "Público",
  3: "Mensagem",
  4: "Agenda",
  5: "Validação",
  6: "Confirmar",
};

const STEP_SHORT_LABELS: Record<Step, string> = {
  1: "Tipo",
  2: "Público",
  3: "Mensagem",
  4: "Regras",
  5: "Validação",
  6: "Revisão",
};

const KIND_OPTIONS: Array<{ kind: CampaignKind; label: string; description: string }> = [
  {
    kind: "lead_campaign",
    label: "Follow-up para leads",
    description: "Envia mensagens para leads selecionados por segmento, tag ou funil",
  },
  {
    kind: "group_campaign",
    label: "Aviso para grupos",
    description: "Envia mensagens para grupos WhatsApp selecionados",
  },
];

interface AudienceTarget {
  target_kind: "segment" | "tag" | "funnel_stage" | "group" | "manual";
  target_id?: string | null;
}

interface MessageStep {
  send_mode: "immediate" | "scheduled_at" | "delay_after_previous";
  message_text: string;
  scheduled_at?: string;
  delay_amount?: number;
  delay_unit?: "minutes" | "hours" | "days";
  media_type?: "none" | "image" | "video" | "audio" | "document";
  media_url?: string;
  media_filename?: string;
  media_mime_type?: string | null;
  media_size?: number | null;
}

export function CrmCampaignWizard({ open, onOpenChange, segments, tags, pipelines, stages, groups, initialData }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [isPending, startTransition] = useTransition();

  // Etapa 1
  const [kind, setKind] = useState<CampaignKind>("lead_campaign");
  const [name, setName] = useState("");

  // Etapa 2
  const [targetKind, setTargetKind] = useState<AudienceTarget["target_kind"]>("segment");
  const [targetId, setTargetId] = useState("");
  const [responsible, setResponsible] = useState<string>("all");
  const [advancedFilters, setAdvancedFilters] = useState({
    onlyWithPhone: true,
  });

  // Etapa 3
  const [msgText, setMsgText] = useState("");
  const [mediaType, setMediaType] = useState<NonNullable<MessageStep["media_type"]>>("none");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFilename, setMediaFilename] = useState("");
  const [mediaMimeType, setMediaMimeType] = useState<string | null>(null);
  const [mediaSize, setMediaSize] = useState<number | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  function insertVariable(variable: string) {
    const start = textareaRef.current?.selectionStart ?? msgText.length;
    const end = textareaRef.current?.selectionEnd ?? msgText.length;
    const newText = msgText.substring(0, start) + variable + msgText.substring(end);
    setMsgText(newText);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start + variable.length, start + variable.length);
      }
    }, 0);
  }

  const [followupEnabled, setFollowupEnabled] = useState(false);
  const [followupText, setFollowupText] = useState("");

  // Etapa 4
  const [sendMode, setSendMode] = useState<MessageStep["send_mode"]>("immediate");
  const [scheduledAt, setScheduledAt] = useState("");
  const [followupDelayAmount, setFollowupDelayAmount] = useState(1);
  const [followupDelayUnit, setFollowupDelayUnit] = useState<"hours" | "days">("days");

  // Regras Avançadas
  const [sendWindowStart, setSendWindowStart] = useState<string>("");
  const [sendWindowEnd, setSendWindowEnd] = useState<string>("");
  const [rateLimit, setRateLimit] = useState<string>("");
  const [stopOnReply, setStopOnReply] = useState(true);

  // Etapa 5
  const [preview, setPreview] = useState<CampaignAudiencePreview | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [finalError, setFinalError] = useState<string | null>(null);

  // Efeito para carregar a prévia ao vivo na Etapa 2
  useEffect(() => {
    if (step !== 2 || !targetId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      setIsPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setIsPreviewLoading(true);
    previewCampaignAudience(kind === "group_campaign" ? "group_campaign" : "lead_campaign", [
      {
        target_kind: targetKind,
        target_id: targetId,
        filters: { responsible, ...advancedFilters }
      }
    ]).then((result) => {
      if (cancelled) return;
      setIsPreviewLoading(false);
      if (result && "data" in result && result.data) {
        setPreview(result.data);
      } else {
        setPreview(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [step, targetId, targetKind, kind, responsible, advancedFilters]);

  // Efeito para repopular os dados se formos editar ou duplicar
  useEffect(() => {
    if (open && initialData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCreatedId(initialData.id);
      setKind(initialData.kind);
      setName(initialData.name);
      setStopOnReply(initialData.stop_on_reply);
      setSendWindowStart(initialData.send_window_start ?? "");
      setSendWindowEnd(initialData.send_window_end ?? "");
      setRateLimit(initialData.rate_limit_per_minute ? String(initialData.rate_limit_per_minute) : "");

      if (initialData.targets && initialData.targets.length > 0) {
        const t = initialData.targets[0];
        const safeTargetKind = t.target_kind === "lead" ? "segment" : t.target_kind;
        setTargetKind(safeTargetKind);
        setTargetId(t.target_kind === "lead" ? "" : t.target_id ?? "");
        const f = t.filters as { responsible?: unknown; onlyWithPhone?: unknown } | null;
        if (f) {
          setResponsible(typeof f.responsible === "string" ? f.responsible : "all");
          setAdvancedFilters({
            onlyWithPhone: typeof f.onlyWithPhone === "boolean" ? f.onlyWithPhone : true,
          });
        }
      }

      if (initialData.steps && initialData.steps.length > 0) {
        const step1 = initialData.steps.find((s) => s.position === 1);
        if (step1) {
          setMsgText(step1.message_text ?? "");
          setMediaType(step1.media_type);
          setMediaUrl(step1.media_url ?? "");
          setMediaFilename(step1.media_filename ?? "");
          setMediaMimeType(step1.media_mime_type);
          setMediaSize(step1.media_size);
          setSendMode(step1.send_mode);
          setScheduledAt(step1.scheduled_at ? step1.scheduled_at.substring(0, 16) : "");
        }

        const step2 = initialData.steps.find((s) => s.position === 2);
        if (step2) {
          setFollowupEnabled(true);
          setFollowupText(step2.message_text ?? "");
          setFollowupDelayAmount(step2.delay_amount ?? 1);
          setFollowupDelayUnit(step2.delay_unit === "hours" ? "hours" : "days");
        } else {
          setFollowupEnabled(false);
          setFollowupText("");
        }
      }
    }
  }, [open, initialData]);

  function reset() {
    setStep(1);
    setKind("lead_campaign");
    setName("");
    setTargetKind("segment");
    setTargetId("");
    setMsgText("");
    setMediaType("none");
    setMediaUrl("");
    setMediaFilename("");
    setMediaMimeType(null);
    setMediaSize(null);
    setMediaUploadError(null);
    setFollowupEnabled(false);
    setFollowupText("");
    setSendMode("immediate");
    setScheduledAt("");
    setFollowupDelayAmount(1);
    setFollowupDelayUnit("days");
    setSendWindowStart("");
    setSendWindowEnd("");
    setRateLimit("");
    setStopOnReply(true);
    setPreview(null);
    setValidationError(null);
    setCreatedId(null);
    setFinalError(null);
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  // Etapa 5: valida campanha
  async function runValidation(campaignId: string) {
    setValidationError(null);
    setPreview(null);
    const result = await validateCampaign(campaignId);
    if (result && "error" in result) {
      setValidationError(result.error ?? "Erro ao validar");
    } else if (result && "data" in result && result.data) {
      setPreview(result.data);
    }
  }

  // Etapa 6: agenda
  async function handleSchedule() {
    if (!createdId) return;
    startTransition(async () => {
      const result = await scheduleCampaign(createdId);
      if (result && "error" in result) {
        setFinalError(result.error ?? "Erro ao agendar");
      } else {
        handleClose(false);
      }
    });
  }

  // Salva rascunho (cria ou atualiza)
  async function saveDraftSilent() {
    const rateLimitNum = rateLimit ? parseInt(rateLimit, 10) : null;
    const input: CreateCampaignDraftInput = {
      name: name.trim() || "Nova Campanha",
      kind,
      mode: followupEnabled ? "sequence" : "single",
      timezone: "America/Sao_Paulo",
      send_window_start: sendWindowStart || null,
      send_window_end: sendWindowEnd || null,
      rate_limit_per_minute: !isNaN(rateLimitNum as number) && rateLimitNum !== null ? rateLimitNum : null,
      stop_on_reply: kind === "lead_campaign" ? stopOnReply : false,
      steps: [
        {
          position: 1,
          send_mode: sendMode,
          message_text: msgText || "...", // Fallback to avoid null constraint se for cedo
          scheduled_at: sendMode === "scheduled_at" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
          media_type: mediaType,
          media_url: mediaType === "none" ? null : mediaUrl.trim(),
          media_filename: mediaType === "none" ? null : mediaFilename.trim() || undefined,
          media_mime_type: mediaMimeType,
          media_size: mediaSize,
          caption: mediaType === "none" ? null : msgText || null,
        },
        ...(followupEnabled ? [{
          position: 2,
          send_mode: "delay_after_previous" as const,
          delay_amount: followupDelayAmount,
          delay_unit: followupDelayUnit,
          message_text: followupText || "...",
          media_type: "none" as const,
        }] : []),
      ],
      targets: [
        {
          target_kind: targetKind,
          target_id: targetId || null,
          filters: {
            responsible,
            ...advancedFilters
          }
        },
      ],
    };

    if (createdId) {
      const updateRes = await updateCampaignDraft(createdId, input);
      if (updateRes && "error" in updateRes) {
        setFinalError(updateRes.error ?? "Erro ao atualizar rascunho");
        return null;
      }
      return createdId;
    } else {
      const result = await createCampaignDraft(input);
      if (result && "error" in result) {
        setFinalError(result.error ?? "Erro ao criar rascunho");
        return null;
      }
      const id = (result?.data as { id: string } | undefined)?.id;
      if (id) setCreatedId(id);
      return id ?? null;
    }
  }

  // Avança para próxima etapa
  function handleNext() {
    startTransition(async () => {
      if (step === 4) {
        setFinalError(null);
        const id = await saveDraftSilent();
        if (!id) return; // Erro ao salvar
        await runValidation(id);
      }

      setStep((s) => Math.min(s + 1, 6) as Step);
    });
  }

  // Ação explícita do botão "Salvar rascunho"
  function handleDraft() {
    startTransition(async () => {
      const id = await saveDraftSilent();
      if (id) {
        handleClose(false);
      }
    });
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 1) as Step);
  }

  async function handleMediaFile(file: File | null) {
    setMediaUploadError(null);
    if (!file) return;

    const formData = new FormData();
    formData.set("file", file);
    setMediaUploading(true);
    try {
      const result = await uploadCampaignMediaAction(formData);
      if (result && "error" in result) {
        setMediaUploadError(result.error ?? "Erro ao enviar mídia");
        return;
      }

      const uploaded = result?.data;
      if (!uploaded) {
        setMediaUploadError("Upload sem retorno de mídia");
        return;
      }

      setMediaType(uploaded.media_type);
      setMediaUrl(uploaded.media_url);
      setMediaFilename(uploaded.media_filename);
      setMediaMimeType(uploaded.media_mime_type);
      setMediaSize(uploaded.media_size);
    } finally {
      setMediaUploading(false);
    }
  }

  function clearMedia() {
    setMediaType("none");
    setMediaUrl("");
    setMediaFilename("");
    setMediaMimeType(null);
    setMediaSize(null);
    setMediaUploadError(null);
    if (mediaInputRef.current) mediaInputRef.current.value = "";
  }

  const canNext =
    (step === 1 && name.trim().length > 0) ||
    (step === 2 && (targetId.trim().length > 0 || targetKind === "manual")) ||
    (step === 3 && (msgText.trim().length > 0 || (mediaType !== "none" && mediaUrl.trim().length > 0)) && (!followupEnabled || followupText.trim().length > 0)) ||
    (step === 4 && (sendMode !== "scheduled_at" || scheduledAt.trim().length > 0)) ||
    (step === 5 && preview !== null && preview.eligible_count > 0) ||
    step === 6;

  const targetOptions =
    kind === "group_campaign"
      ? [{ value: "group", label: "Grupo específico" }]
      : [
          { value: "segment", label: "Segmento" },
          { value: "tag", label: "Tag" },
          { value: "funnel_stage", label: "Etapa do funil" },
        ];

  const targetIdOptions: Array<{ id: string; name: string }> =
    targetKind === "segment" ? segments
    : targetKind === "tag" ? tags
    : targetKind === "funnel_stage" ? stages.map((s) => ({
        id: s.id,
        name: `${pipelines.find((p) => p.id === s.pipeline_id)?.name ?? "?"} › ${s.name}`,
      }))
    : targetKind === "group" ? groups.map((g) => ({
        id: g.id,
        name: `${g.name}${g.participant_count ? ` (${g.participant_count})` : ""}`,
      }))
    : [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex flex-col max-h-[90vh] w-full max-w-[720px] overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b px-7 pb-5 pt-5">
          <div className="space-y-6">
            <div className="text-left">
              <DialogTitle className="text-lg">Criar Nova Campanha</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Configure sua campanha em poucos passos.
              </p>
            </div>
            
            <div className="relative flex justify-between px-2">
              <div className="absolute left-6 right-6 top-[14px] h-[2px] -translate-y-1/2 bg-border z-0" />
              <div className="absolute left-6 top-[14px] h-[2px] -translate-y-1/2 bg-success z-0 transition-all" style={{ width: `calc(${((step - 1) / 5) * 100}% - 48px)` }} />
              
              {([1, 2, 3, 4, 5, 6] as Step[]).map((s) => {
                const isCompleted = s < step;
                const isActive = s === step;
                
                return (
                  <div key={s} className="relative z-10 flex flex-col items-center gap-2">
                    <div
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors border-2 ${
                        isCompleted
                          ? "bg-success border-success text-success-foreground"
                          : isActive
                            ? "bg-primary border-primary text-primary-foreground"
                            : "bg-background border-border text-muted-foreground"
                      }`}
                    >
                      {isCompleted ? <CheckCircle2 className="size-4" /> : s}
                    </div>
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${
                      isCompleted || isActive ? "text-primary" : "text-muted-foreground"
                    }`}>
                      {STEP_SHORT_LABELS[s]}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-7 py-7">
          {/* Etapa 1: Objetivo */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Escolha o tipo de campanha</h2>
                <p className="mt-1 text-sm text-muted-foreground">Selecione como os destinatários serão atingidos.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  {
                    kind: "lead_campaign" as CampaignKind,
                    label: "Campanha para Leads",
                    description: "Enviar mensagens para leads filtrados por funil, etapa ou tag.",
                    icon: <UserCircle className="size-5" />
                  },
                  {
                    kind: "group_campaign" as CampaignKind,
                    label: "Aviso para Grupos",
                    description: "Enviar comunicados para grupos de WhatsApp selecionados.",
                    icon: <Users className="size-5" />
                  }
                ].map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    onClick={() => {
                      setKind(opt.kind);
                      setTargetKind(opt.kind === "group_campaign" ? "group" : "segment");
                      setTargetId("");
                    }}
                    className={`flex h-auto w-full flex-col items-start gap-4 rounded-xl border p-5 text-left transition-all hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      kind === opt.kind
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className={`flex size-10 items-center justify-center rounded-lg ${kind === opt.kind ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-foreground/80'}`}>
                      {opt.icon}
                    </div>
                    <div className="space-y-1">
                      <span className="block font-semibold text-foreground text-sm">{opt.label}</span>
                      <span className="block text-xs text-muted-foreground leading-relaxed">{opt.description}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="space-y-2 pt-2">
                <Label htmlFor="camp-name" className="font-semibold text-sm">Nome da campanha</Label>
                <Input
                  id="camp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Follow-up Leads Frios Junho"
                  className="h-11"
                />
              </div>
            </div>
          )}

          {/* Etapa 2: Público */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Selecione os destinatários</h2>
                <p className="mt-1 text-sm text-muted-foreground">Use os filtros para segmentar sua audiência.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
                {/* Left Col: Filters */}
                <div className="space-y-6 rounded-xl border p-5 bg-card">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase">Tipo de público</Label>
                      <Select value={targetKind} onValueChange={(v) => { setTargetKind(v as AudienceTarget["target_kind"]); setTargetId(""); }}>
                        <SelectTrigger className="h-9"><SelectValue>{(v: string | null) => targetOptions.find((o) => o.value === v)?.label ?? v ?? ""}</SelectValue></SelectTrigger>
                        <SelectContent>{targetOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase">Responsável</Label>
                      <Select value={responsible} onValueChange={(v) => setResponsible(v ?? "all")}>
                        <SelectTrigger className="h-9"><SelectValue>{(v: string) => v === "all" ? "Todos" : v}</SelectValue></SelectTrigger>
                        <SelectContent><SelectItem value="all">Todos</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>

                  {targetIdOptions.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase">Selecionar {targetKind === "segment" ? "segmento" : targetKind === "tag" ? "tag" : targetKind === "group" ? "grupo" : "etapa"}</Label>
                      <Select value={targetId} onValueChange={(v) => setTargetId(v ?? "")}>
                        <SelectTrigger className="h-9"><SelectValue>{(v: string | null) => v ? targetIdOptions.find((o) => o.id === v)?.name ?? v : "Selecione..."}</SelectValue></SelectTrigger>
                        <SelectContent>{targetIdOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-3 pt-2 border-t mt-4">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase pt-4 block">Filtros Avançados</Label>
                    <div className="grid grid-cols-1 gap-y-3 gap-x-4">
                      <label className="flex items-start gap-2 text-sm cursor-pointer"><Checkbox checked={advancedFilters.onlyWithPhone} onCheckedChange={(c) => setAdvancedFilters(prev => ({ ...prev, onlyWithPhone: !!c }))} /> <span className="leading-tight">Apenas leads com telefone</span></label>
                    </div>
                    <p className="text-xs text-muted-foreground">Duplicados são removidos automaticamente antes do envio.</p>
                  </div>
                </div>

                {/* Right Col: Preview */}
                <div className="rounded-xl border p-5 bg-card flex flex-col gap-4 h-fit">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <CheckCircle2 className="size-4 text-muted-foreground" /> Prévia do público
                  </h3>
                  {isPreviewLoading ? (
                    <div className="flex flex-col items-center justify-center py-6 gap-2 text-muted-foreground">
                      <Loader2 className="size-6 animate-spin" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Calculando...</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Encontrados</span>
                        <span className="font-bold">{preview?.found_count ?? 0}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Enviáveis</span>
                        <span className="font-bold text-success">{preview?.eligible_count ?? 0}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Duplicados</span>
                        <span className="font-bold text-warning">{preview?.duplicate_count ?? 0}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Inelegíveis</span>
                        <span className="font-bold text-destructive">{preview?.ineligible_count ?? 0}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Etapa 3: Mensagem */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Monte a mensagem</h2>
                <p className="mt-1 text-sm text-muted-foreground">Personalize o texto com variáveis dinâmicas.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
                {/* Left Col: Editor */}
                <div className="space-y-4">
                  <div className="relative">
                    <Textarea
                      ref={textareaRef}
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      rows={8}
                      className="resize-none pr-3 pb-8"
                      placeholder={`Olá {{primeiro_nome}}, tudo bem? Passando para lembrar sobre...`}
                    />
                    <div className="absolute bottom-2 right-3 flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                      <span>{msgText.length} CHARS</span>
                      <span>{(msgText.match(/\{\{.*?\}\}/g) || []).length}/2 VARIÁVEIS</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {["{{nome}}", "{{primeiro_nome}}", "{{telefone}}", "{{etapa}}", "{{responsavel}}", "{{link_agendamento}}"].map(v => (
                      <button
                        key={v}
                        onClick={() => insertVariable(v)}
                        className="rounded-full bg-muted/50 border px-3 py-1 text-xs font-semibold hover:bg-muted transition-colors text-foreground/80"
                      >
                        {v}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-4 pt-2">
                    <input
                      ref={mediaInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                      onChange={(event) => void handleMediaFile(event.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={mediaUploading}
                      onClick={() => mediaInputRef.current?.click()}
                    >
                      {mediaUploading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />}
                      {mediaUploading ? "Enviando..." : "Adicionar mídia"}
                    </Button>
                  </div>
                  {mediaUploadError && (
                    <p className="text-xs font-medium text-destructive">{mediaUploadError}</p>
                  )}
                  {mediaType !== "none" && mediaUrl && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{mediaFilename || "Mídia anexada"}</p>
                        <p className="text-xs text-muted-foreground">{mediaMimeType ?? mediaType}</p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={clearMedia}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Right Col: WhatsApp Preview */}
                <div className="flex justify-center h-fit">
                  {/* Phone Mockup */}
                  <div className="w-[280px] h-[450px] bg-card rounded-[2.5rem] border-8 border-foreground/90 overflow-hidden relative shadow-xl">
                    {/* Speaker notch */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-foreground/90 rounded-b-2xl z-20"></div>
                    
                    {/* WA Header */}
                    <div className="bg-primary h-16 flex items-center px-4 pt-4 text-primary-foreground gap-3 sticky top-0 z-10">
                      <div className="size-8 rounded-full bg-primary-foreground/20 shrink-0"></div>
                      <div>
                        <div className="text-sm font-semibold leading-tight">Pérsia CRM</div>
                        <div className="text-[10px] text-primary-foreground/80">Online</div>
                      </div>
                    </div>

                    {/* WA Body */}
                    <div className="bg-muted/40 h-full p-3 flex flex-col gap-2 overflow-y-auto pb-20">
                      <div className="bg-primary/15 self-end max-w-[85%] rounded-lg p-2 pb-5 text-sm text-foreground shadow-sm relative break-words whitespace-pre-wrap">
                        {msgText || "Olá Maria, tudo bem?\n\nPassando para lembrar sobre..."}
                        <span className="absolute bottom-1 right-2 text-[9px] text-muted-foreground">15:30</span>
                      </div>
                    </div>

                    {/* WA Input */}
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-muted/60 flex items-center px-2 z-10">
                      <div className="h-10 bg-card rounded-full flex-1 shadow-sm"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Etapa 4: Agenda */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Configure as regras</h2>
                <p className="mt-1 text-sm text-muted-foreground">Controle a velocidade e horários de envio.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Col: Scheduling & Speed */}
                <div className="space-y-6 rounded-xl border p-5 bg-card h-fit">
                  <div className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <CalendarClock className="size-4 text-primary" /> Quando enviar?
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setSendMode("immediate")}
                        className={`py-2 px-4 rounded-lg border text-sm font-semibold transition-colors ${
                          sendMode === "immediate" ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        Agendar agora
                      </button>
                      <button
                        onClick={() => setSendMode("scheduled_at")}
                        className={`py-2 px-4 rounded-lg border text-sm font-semibold transition-colors ${
                          sendMode === "scheduled_at" ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        Agendar horário
                      </button>
                    </div>
                  </div>

                  {sendMode === "scheduled_at" && (
                    <div className="space-y-1.5 animate-in fade-in zoom-in-95 duration-200">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase">Data e hora</Label>
                      <Input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="h-10"
                      />
                    </div>
                  )}

                  <div className="space-y-4 pt-4 border-t">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase">Limite de envios por min.</Label>
                      <div className="w-32 relative">
                        <Input
                          type="number"
                          value={rateLimit}
                          onChange={e => setRateLimit(e.target.value)}
                          placeholder="Padrão"
                          className="h-10 pl-3 pr-10 font-medium"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">/min</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Deixe vazio para velocidade máxima do provedor.</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase">Janela de Envio Seguro</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={sendWindowStart}
                          onChange={e => setSendWindowStart(e.target.value)}
                          className="h-10 w-28 text-center font-medium"
                        />
                        <span className="text-muted-foreground text-sm font-semibold">até</span>
                        <Input
                          type="time"
                          value={sendWindowEnd}
                          onChange={e => setSendWindowEnd(e.target.value)}
                          className="h-10 w-28 text-center font-medium"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">Pausa envios automaticamente fora deste horário (Fuso: SP).</p>
                    </div>
                  </div>
                </div>

                {/* Right Col: Follow-up Automático */}
                <div className="space-y-6 rounded-xl border p-5 bg-card flex flex-col h-fit">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Zap className="size-4 text-primary" /> Follow-up Automático
                    </h3>
                    <Checkbox
                      checked={followupEnabled}
                      onCheckedChange={(c) => setFollowupEnabled(!!c)}
                      className="rounded-full w-10 h-5 border-2 border-transparent bg-muted data-[state=checked]:bg-primary relative transition-colors"
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${followupEnabled ? "translate-x-5" : "translate-x-0"}`} />
                    </Checkbox>
                  </div>
                  <p className="text-xs text-muted-foreground">Envie mensagens automáticas se o lead não responder após o primeiro contato.</p>
                  
                  {/* Diagram */}
                  <div className={`mt-4 rounded-xl border bg-muted/20 p-6 flex flex-col items-center gap-4 transition-opacity ${followupEnabled ? "opacity-100" : "opacity-40 grayscale pointer-events-none"}`}>
                    <div className="flex items-center justify-center w-full max-w-[200px]">
                      <div className="size-8 rounded-md bg-primary text-primary-foreground font-bold flex items-center justify-center shadow-sm z-10">1</div>
                      <div className="flex-1 h-[2px] bg-primary relative">
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-muted-foreground bg-card px-1 rounded border">2d</span>
                      </div>
                      <div className="size-8 rounded-md border-2 border-primary bg-background text-primary font-bold flex items-center justify-center shadow-sm z-10">2</div>
                    </div>
                    <div className="text-[10px] font-bold tracking-widest text-primary bg-primary/10 px-3 py-1 rounded-full">
                      FLUXO DE FOLLOW-UP ATIVO
                    </div>
                  </div>
                  
                  {followupEnabled && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase">Mensagem do Follow-up</Label>
                        <Textarea
                          value={followupText}
                          onChange={(e) => setFollowupText(e.target.value)}
                          placeholder="Ex: Ainda posso te ajudar com isso?"
                          rows={3}
                          className="resize-none"
                        />
                      </div>
                    </div>
                  )}

                  {kind === "lead_campaign" && (
                    <div className="pt-4 border-t flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-semibold text-foreground">Parar se responder</Label>
                        <p className="text-xs text-muted-foreground">A campanha pausa se o lead mandar mensagem.</p>
                      </div>
                      <Checkbox
                        checked={stopOnReply}
                        onCheckedChange={(c) => setStopOnReply(!!c)}
                        className="rounded-full w-10 h-5 border-2 border-transparent bg-muted data-[state=checked]:bg-primary relative transition-colors"
                      >
                        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${stopOnReply ? "translate-x-5" : "translate-x-0"}`} />
                      </Checkbox>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Etapa 5: Validação */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Valide os destinatários</h2>
                <p className="mt-1 text-sm text-muted-foreground">Garanta que a campanha será entregue com segurança.</p>
              </div>

              {isPending && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Validando campanha...
                </div>
              )}
              {validationError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm flex gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <span>{validationError}</span>
                </div>
              )}
              {preview && (
                <div className="space-y-6">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-xl border bg-card p-4 flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Enviáveis</span>
                      <span className="text-2xl font-bold text-success mt-2">{preview.eligible_count}</span>
                    </div>
                    <div className="rounded-xl border bg-card p-4 flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Inelegíveis</span>
                      <span className="text-2xl font-bold text-warning mt-2">{preview.ineligible_count}</span>
                    </div>
                    <div className="rounded-xl border bg-card p-4 flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Duplicados</span>
                      <span className="text-2xl font-bold text-foreground mt-2">{preview.duplicate_count}</span>
                    </div>
                    <div className="rounded-xl border bg-card p-4 flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Inelegíveis</span>
                      <span className="text-2xl font-bold text-destructive mt-2">{preview.ineligible_count}</span>
                    </div>
                  </div>

                  {preview.warnings.length > 0 && (
                    <div className="space-y-1">
                      {preview.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-warning flex gap-1.5 font-medium">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {w}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Data Table */}
                  <div className="rounded-xl border bg-card overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted/50 text-[10px] uppercase font-bold text-muted-foreground tracking-wider border-b">
                        <tr>
                          <th className="px-5 py-3 font-bold">Nome</th>
                          <th className="px-5 py-3 font-bold">Status</th>
                          <th className="px-5 py-3 font-bold">Motivo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {preview.recipients && preview.recipients.length > 0 ? (
                          preview.recipients.slice(0, 50).map((r, i) => (
                            <tr key={i} className="hover:bg-muted/30 transition-colors">
                              <td className="px-5 py-3 font-medium text-foreground">
                                {r.display_name || r.phone || "Desconhecido"}
                              </td>
                              <td className="px-5 py-3">
                                {r.eligible ? (
                                  <span className="text-[10px] font-bold text-success uppercase">OK</span>
                                ) : (
                                  <span className="text-[10px] font-bold text-destructive uppercase">ERRO</span>
                                )}
                              </td>
                              <td className="px-5 py-3 text-muted-foreground text-xs">
                                {r.eligible ? "Enviável" : r.ineligible_reason || "Inválido"}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3} className="px-5 py-8 text-center text-muted-foreground">
                              Nenhum destinatário encontrado
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {preview.recipients && preview.recipients.length > 50 && (
                      <div className="bg-muted/30 px-5 py-3 text-xs text-center text-muted-foreground border-t">
                        Mostrando os 50 primeiros de {preview.found_count}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Etapa 6: Confirmar */}
          {step === 6 && (
            <FormSection
              icon={<CheckCircle2 className="size-4 text-muted-foreground" />}
              title="Confirmar"
              description="Revise os principais dados da campanha"
            >
              <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nome</span>
                  <span className="font-medium">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tipo</span>
                  <span>{kind === "lead_campaign" ? "Leads" : "Grupos"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agenda</span>
                  <span>{sendMode === "immediate" ? "Imediato" : scheduledAt}</span>
                </div>
                {preview && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Destinatários</span>
                    <span className="font-medium">{preview.eligible_count} enviáveis</span>
                  </div>
                )}
              </div>
              {finalError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm">
                  {finalError}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Ao confirmar, a campanha será agendada. Os destinatários serão congelados agora.
              </p>
            </FormSection>
          )}
        </div>

        <DialogFooter className="border-t bg-background px-6 py-4">
          <div className="flex w-full justify-between items-center">
            {step > 1 ? (
              <Button variant="ghost" onClick={handleBack} disabled={isPending} className="pl-2">
                <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
            ) : <div />}
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handleDraft} disabled={isPending}>
                <Save className="h-4 w-4 mr-1.5" />
                Salvar rascunho
              </Button>
              {step < 6 ? (
                <Button onClick={handleNext} disabled={!canNext || isPending} className="px-6">
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : null}
                  Continuar <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={handleSchedule} disabled={isPending} className="px-6">
                  {isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  Agendar Campanha
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="space-y-0.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </h3>
        {description && (
          <p className="pl-6 text-xs text-muted-foreground">{description}</p>
        )}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
