"use client";

// Wizard de criação de campanha — 6 etapas conforme roadmap.
// Etapa 1: Objetivo (tipo) → 2: Público → 3: Mensagem → 4: Agenda → 5: Validação → 6: Confirmar

import { useState, useTransition, useRef } from "react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@persia/ui/dialog";
import { Badge } from "@persia/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@persia/ui/select";
import {
  Users, MessageSquare, CheckCircle2, AlertCircle, Loader2,
  ChevronRight, ChevronLeft,
} from "lucide-react";
import type {
  CampaignKind, CreateCampaignDraftInput, CampaignAudiencePreview,
} from "@persia/shared/crm";
import {
  createCampaignDraft, validateCampaign, scheduleCampaign,
} from "@/actions/crm-campaigns";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  segments: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  pipelines: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; pipeline_id: string; name: string }>;
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
}

export function CrmCampaignWizard({ open, onOpenChange, segments, tags, pipelines, stages }: Props) {
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

  // Etapa 4
  const [sendMode, setSendMode] = useState<MessageStep["send_mode"]>("immediate");
  const [scheduledAt, setScheduledAt] = useState("");
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
    setSendMode("immediate");
    setScheduledAt("");
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
          mode: "single",
          stop_on_reply: stopOnReply,
          steps: [
            {
              position: 1,
              send_mode: sendMode,
              message_text: msgText,
              scheduled_at: sendMode === "scheduled_at" ? scheduledAt : null,
              media_type: "none",
            },
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

  const canNext =
    (step === 1 && name.trim().length > 0) ||
    (step === 2 && (targetId.trim().length > 0 || targetKind === "manual")) ||
    (step === 3 && msgText.trim().length > 0) ||
    step === 4 ||
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
    : [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            {([1,2,3,4,5,6] as Step[]).map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
          <DialogTitle className="text-base">
            Etapa {step} — {STEP_LABELS[step]}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-[260px] py-2">
          {/* Etapa 1: Objetivo */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                {KIND_OPTIONS.map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    onClick={() => setKind(opt.kind)}
                    className={`text-left rounded-lg border p-4 transition-colors ${
                      kind === opt.kind
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="font-medium text-sm">{opt.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                  </button>
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
            </div>
          )}

          {/* Etapa 2: Público */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Tipo de público</Label>
                <Select
                  value={targetKind}
                  onValueChange={(v) => { setTargetKind(v as AudienceTarget["target_kind"]); setTargetId(""); }}
                >
                  <SelectTrigger>
                    <SelectValue />
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
                  <Label>Selecionar {targetKind === "segment" ? "segmento" : targetKind === "tag" ? "tag" : "etapa"}</Label>
                  <Select value={targetId} onValueChange={(v) => setTargetId(v ?? "")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {targetIdOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(targetKind === "lead" || targetKind === "group") && (
                <div className="space-y-1.5">
                  <Label>ID do {targetKind === "lead" ? "lead" : "grupo"}</Label>
                  <Input
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    placeholder="Cole o ID aqui"
                  />
                </div>
              )}
            </div>
          )}

          {/* Etapa 3: Mensagem */}
          {step === 3 && (
            <div className="space-y-4">
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
            </div>
          )}

          {/* Etapa 4: Agenda */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Quando enviar</Label>
                <Select value={sendMode} onValueChange={(v) => setSendMode(v as MessageStep["send_mode"])}>
                  <SelectTrigger>
                    <SelectValue />
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
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="stop-on-reply"
                  checked={stopOnReply}
                  onChange={(e) => setStopOnReply(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="stop-on-reply" className="font-normal cursor-pointer">
                  Parar quando lead responder
                </Label>
              </div>
            </div>
          )}

          {/* Etapa 5: Validação */}
          {step === 5 && (
            <div className="space-y-4">
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
            </div>
          )}

          {/* Etapa 6: Confirmar */}
          {step === 6 && (
            <div className="space-y-4">
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
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
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
