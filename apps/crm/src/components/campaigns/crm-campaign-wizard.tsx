"use client";

// Wizard de criação de campanha — 6 etapas conforme roadmap.
// Etapa 1: Objetivo (tipo) → 2: Público → 3: Mensagem → 4: Agenda → 5: Validação → 6: Confirmar

import { useState, useTransition } from "react";
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
} from "lucide-react";
import type {
  CampaignKind, CreateCampaignDraftInput, CampaignAudiencePreview,
} from "@persia/shared/crm";
import {
  createCampaignDraft, validateCampaign, scheduleCampaign, uploadCampaignMediaAction,
} from "@/actions/crm-campaigns";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  segments: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  pipelines: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; pipeline_id: string; name: string }>;
  groups: Array<{ id: string; name: string; category: string | null; participant_count: number | null }>;
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
  target_kind: "segment" | "tag" | "funnel_stage" | "lead" | "group" | "manual";
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

export function CrmCampaignWizard({ open, onOpenChange, segments, tags, pipelines, stages, groups }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [isPending, startTransition] = useTransition();

  // Etapa 1
  const [kind, setKind] = useState<CampaignKind>("lead_campaign");
  const [name, setName] = useState("");

  // Etapa 2
  const [targetKind, setTargetKind] = useState<AudienceTarget["target_kind"]>("segment");
  const [targetId, setTargetId] = useState("");

  // Etapa 3
  const [msgText, setMsgText] = useState("");
  const [mediaType, setMediaType] = useState<NonNullable<MessageStep["media_type"]>>("none");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFilename, setMediaFilename] = useState("");
  const [mediaMimeType, setMediaMimeType] = useState<string | null>(null);
  const [mediaSize, setMediaSize] = useState<number | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [followupEnabled, setFollowupEnabled] = useState(false);
  const [followupText, setFollowupText] = useState("");

  // Etapa 4
  const [sendMode, setSendMode] = useState<MessageStep["send_mode"]>("immediate");
  const [scheduledAt, setScheduledAt] = useState("");
  const [followupDelayAmount, setFollowupDelayAmount] = useState(1);
  const [followupDelayUnit, setFollowupDelayUnit] = useState<"hours" | "days">("days");
  const [stopOnReply, setStopOnReply] = useState(true);

  // Etapa 5
  const [preview, setPreview] = useState<CampaignAudiencePreview | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Etapa 6
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [finalError, setFinalError] = useState<string | null>(null);

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

  // Avança para próxima etapa (criando rascunho na transição 4→5)
  function handleNext() {
    if (step === 4) {
      // Criar rascunho e validar
      startTransition(async () => {
        const input: CreateCampaignDraftInput = {
          name: name.trim() || "Nova Campanha",
          kind,
          mode: followupEnabled ? "sequence" : "single",
          stop_on_reply: kind === "lead_campaign" ? stopOnReply : false,
          steps: [
            {
              position: 1,
              send_mode: sendMode,
              message_text: msgText,
              scheduled_at: sendMode === "scheduled_at" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
              media_type: mediaType,
              media_url: mediaType === "none" ? null : mediaUrl.trim(),
              media_filename: mediaType === "none" ? null : mediaFilename.trim() || undefined,
              media_mime_type: mediaMimeType,
              media_size: mediaSize,
              caption: mediaType === "none" ? null : msgText,
            },
            ...(followupEnabled ? [{
              position: 2,
              send_mode: "delay_after_previous" as const,
              delay_amount: followupDelayAmount,
              delay_unit: followupDelayUnit,
              message_text: followupText,
              media_type: "none" as const,
            }] : []),
          ],
          targets: [
            {
              target_kind: targetKind,
              target_id: targetId || null,
            },
          ],
        };
        const result = await createCampaignDraft(input);
        if (result && "error" in result) {
          setFinalError(result.error ?? "Erro ao criar rascunho");
          return;
        }
        const id = (result?.data as { id: string } | undefined)?.id;
        if (id) {
          setCreatedId(id);
          await runValidation(id);
        }
        setStep(5);
      });
      return;
    }
    setStep((s) => Math.min(s + 1, 6) as Step);
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
          { value: "lead", label: "Lead específico" },
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
      <DialogContent className="left-auto right-0 top-0 h-dvh max-h-dvh w-full max-w-[720px] translate-x-0 translate-y-0 overflow-hidden rounded-none border-l p-0 sm:rounded-none">
        <DialogHeader className="border-b px-7 pb-5 pt-5">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Megaphone className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <DialogTitle className="text-lg">Nova campanha</DialogTitle>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Etapa {step} de 6 - {STEP_LABELS[step]}
                </p>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {([1,2,3,4,5,6] as Step[]).map((s) => (
                  <div key={s} className="min-w-0">
                    <div className="flex items-center">
                      <div
                        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
                          s < step
                            ? "bg-success text-success-foreground"
                            : s === step
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {s < step ? <CheckCircle2 className="size-3.5" /> : s}
                      </div>
                      <div className={`h-px flex-1 ${s < 6 ? s < step ? "bg-primary" : "bg-border" : "bg-transparent"}`} />
                    </div>
                    <p className={`mt-1 truncate text-[10px] font-semibold uppercase ${
                      s === step ? "text-primary" : "text-muted-foreground"
                    }`}>
                      {STEP_SHORT_LABELS[s]}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="h-[calc(100dvh-154px)] overflow-y-auto px-7 py-7">
          {/* Etapa 1: Objetivo */}
          {step === 1 && (
            <FormSection
              icon={<Megaphone className="size-4 text-muted-foreground" />}
              title="Objetivo"
              description="Defina o publico da acao e identifique a campanha"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {KIND_OPTIONS.map((opt) => (
                  <Button
                    key={opt.kind}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setKind(opt.kind);
                      setTargetKind(opt.kind === "group_campaign" ? "group" : "segment");
                      setTargetId("");
                    }}
                    className={`h-36 w-full flex-col items-start justify-start gap-2 rounded-lg border p-5 text-left transition-colors ${
                      kind === opt.kind
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      {opt.kind === "lead_campaign" ? <Users className="size-4" /> : <MessageSquare className="size-4" />}
                    </span>
                    <span className="font-medium text-sm">{opt.label}</span>
                    <span className="text-xs text-muted-foreground font-normal whitespace-normal">{opt.description}</span>
                  </Button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-name">Nome da campanha *</Label>
                <Input
                  id="camp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Follow-up Leads Frios Junho"
                />
              </div>
            </FormSection>
          )}

          {/* Etapa 2: Público */}
          {step === 2 && (
            <FormSection
              icon={<Users className="size-4 text-muted-foreground" />}
              title="Publico"
              description="Selecione a origem dos destinatarios"
            >
              <div className="space-y-1.5">
                <Label>Tipo de público</Label>
                <Select
                  value={targetKind}
                  onValueChange={(v) => { setTargetKind(v as AudienceTarget["target_kind"]); setTargetId(""); }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string | null) => targetOptions.find((o) => o.value === v)?.label ?? v ?? ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {targetOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {targetIdOptions.length > 0 && (
                <div className="space-y-1.5">
                  <Label>
                    Selecionar {
                      targetKind === "segment" ? "segmento"
                      : targetKind === "tag" ? "tag"
                      : targetKind === "group" ? "grupo"
                      : "etapa"
                    }
                  </Label>
                  <Select
                    value={targetId}
                    onValueChange={(v) => setTargetId(v ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(v: string | null) =>
                          v ? targetIdOptions.find((o) => o.id === v)?.name ?? v : "Selecione..."
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {targetIdOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(targetKind === "lead" || (targetKind === "group" && targetIdOptions.length === 0)) && (
                <div className="space-y-1.5">
                  <Label>ID do {targetKind === "lead" ? "lead" : "grupo"}</Label>
                  <Input
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    placeholder="Cole o ID aqui"
                  />
                </div>
              )}
            </FormSection>
          )}

          {/* Etapa 3: Mensagem */}
          {step === 3 && (
            <FormSection
              icon={<Send className="size-4 text-muted-foreground" />}
              title="Mensagem"
              description="Monte o conteudo principal e os anexos"
            >
              <div className="space-y-1.5">
                <Label>Mensagem *</Label>
                <Textarea
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  rows={6}
                  placeholder={`Olá {{primeiro_nome}}, tudo bem?\n\nPassando para...`}
                />
                <p className="text-xs text-muted-foreground">
                  Variáveis: {`{{nome}}`}, {`{{primeiro_nome}}`}, {`{{telefone}}`}
                </p>
              </div>
              <div className="grid gap-3 rounded-lg border p-3">
                <div className="space-y-2">
                  <Label>Mídia</Label>
                  {!mediaUrl ? (
                    <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 py-5 text-center transition-colors hover:bg-muted/50">
                      {mediaUploading ? (
                        <Loader2 className="mb-2 h-5 w-5 animate-spin text-muted-foreground" />
                      ) : (
                        <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium">
                        {mediaUploading ? "Enviando mídia..." : "Selecionar imagem, vídeo, áudio ou documento"}
                      </span>
                      <span className="mt-1 text-xs text-muted-foreground">
                        JPEG, PNG, WEBP, MP4, áudio, PDF, DOCX e XLSX
                      </span>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                        disabled={mediaUploading}
                        onChange={(e) => {
                          void handleMediaFile(e.target.files?.[0] ?? null);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ) : (
                    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{mediaFilename || "Mídia anexada"}</p>
                        <p className="text-xs text-muted-foreground">
                          {mediaType} {mediaSize ? `• ${(mediaSize / 1024 / 1024).toFixed(1)} MB` : ""}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" onClick={clearMedia}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  {mediaUploadError && (
                    <p className="text-xs text-destructive">{mediaUploadError}</p>
                  )}
                </div>
                {mediaUrl && (
                  <div className="space-y-1.5">
                    <Label>Nome do arquivo</Label>
                    <Input
                      value={mediaFilename}
                      onChange={(e) => setMediaFilename(e.target.value)}
                      placeholder="Ex: proposta.pdf"
                    />
                  </div>
                )}
              </div>
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="followup-enabled"
                    checked={followupEnabled}
                    onCheckedChange={(v) => setFollowupEnabled(v === true)}
                  />
                  <Label htmlFor="followup-enabled" className="font-normal cursor-pointer">
                    Adicionar follow-up
                  </Label>
                </div>
                {followupEnabled && (
                  <div className="space-y-1.5">
                    <Label>Mensagem de follow-up *</Label>
                    <Textarea
                      value={followupText}
                      onChange={(e) => setFollowupText(e.target.value)}
                      rows={4}
                      placeholder="Ainda posso te ajudar com isso?"
                    />
                  </div>
                )}
              </div>
            </FormSection>
          )}

          {/* Etapa 4: Agenda */}
          {step === 4 && (
            <FormSection
              icon={<CalendarClock className="size-4 text-muted-foreground" />}
              title="Agenda"
              description="Configure envio, follow-up e parada por resposta"
            >
              <div className="space-y-1.5">
                <Label>Quando enviar</Label>
                <Select
                  value={sendMode}
                  onValueChange={(v) => setSendMode(v as MessageStep["send_mode"])}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string | null) =>
                        v === "immediate" ? "Enviar assim que agendado"
                        : v === "scheduled_at" ? "Em uma data/hora específica"
                        : v ?? ""
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate">Enviar assim que agendado</SelectItem>
                    <SelectItem value="scheduled_at">Em uma data/hora específica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {sendMode === "scheduled_at" && (
                <div className="space-y-1.5">
                  <Label>Data e hora</Label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </div>
              )}
              {followupEnabled && (
                <div className="grid grid-cols-[1fr_140px] gap-3">
                  <div className="space-y-1.5">
                    <Label>Delay do follow-up</Label>
                    <Input
                      type="number"
                      min={1}
                      value={followupDelayAmount}
                      onChange={(e) => setFollowupDelayAmount(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Unidade</Label>
                    <Select
                      value={followupDelayUnit}
                      onValueChange={(v) => setFollowupDelayUnit(v as "hours" | "days")}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {(v: string | null) => v === "hours" ? "Horas" : "Dias"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hours">Horas</SelectItem>
                        <SelectItem value="days">Dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              {kind === "lead_campaign" && (
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox
                    id="stop-on-reply"
                    checked={stopOnReply}
                    onCheckedChange={(v) => setStopOnReply(v === true)}
                  />
                  <Label htmlFor="stop-on-reply" className="font-normal cursor-pointer">
                    Parar quando lead responder
                  </Label>
                </div>
              )}
            </FormSection>
          )}

          {/* Etapa 5: Validação */}
          {step === 5 && (
            <FormSection
              icon={<ShieldCheck className="size-4 text-muted-foreground" />}
              title="Validacao"
              description="Confira os destinatarios encontrados antes de agendar"
            >
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
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-muted p-3 text-center">
                      <div className="text-2xl font-bold">{preview.found_count}</div>
                      <div className="text-xs text-muted-foreground">Encontrados</div>
                    </div>
                    <div className="rounded-lg bg-success-soft p-3 text-center">
                      <div className="text-2xl font-bold text-success-soft-foreground">{preview.eligible_count}</div>
                      <div className="text-xs text-muted-foreground">Enviáveis</div>
                    </div>
                    <div className="rounded-lg bg-destructive/10 p-3 text-center">
                      <div className="text-2xl font-bold text-destructive">{preview.ineligible_count}</div>
                      <div className="text-xs text-muted-foreground">Descartados</div>
                    </div>
                  </div>
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-warning-soft-foreground flex gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
                    </p>
                  ))}
                  {preview.eligible_count > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-success-soft-foreground" />
                      Pronto para agendar {preview.eligible_count} destinatário{preview.eligible_count !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              )}
            </FormSection>
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

        <DialogFooter className="gap-2 border-t bg-background px-6 py-4">
          {step > 1 && (
            <Button variant="ghost" onClick={handleBack} disabled={isPending}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          )}
          {step < 6 && (
            <Button onClick={handleNext} disabled={!canNext || isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <ChevronRight className="h-4 w-4 mr-1" />
              )}
              {step === 4 ? "Validar" : "Próximo"}
            </Button>
          )}
          {step === 6 && (
            <Button onClick={handleSchedule} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <MessageSquare className="h-4 w-4 mr-1.5" />
              )}
              Agendar Campanha
            </Button>
          )}
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
