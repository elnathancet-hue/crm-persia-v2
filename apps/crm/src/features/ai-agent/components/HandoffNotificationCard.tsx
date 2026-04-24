"use client";

import * as React from "react";
import { BellRing, Eye, Info, MessageSquare, Phone, RotateCcw, Users } from "lucide-react";
import type { HandoffNotificationTargetType } from "@persia/shared/ai-agent";
import {
  HANDOFF_DEFAULT_TEMPLATE,
  HANDOFF_PHONE_MAX_DIGITS,
  HANDOFF_PHONE_MIN_DIGITS,
  HANDOFF_TEMPLATE_MAX_LENGTH,
  HANDOFF_TEMPLATE_VARIABLES,
  isKnownTemplateVariable,
  listTemplatePlaceholders,
  renderHandoffTemplate,
} from "@persia/shared/ai-agent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const PREVIEW_VARIABLES = {
  lead_name: "Maria Silva",
  lead_phone: "+55 11 99999-0000",
  summary: "Lead interessado em plano anual. Pediu demonstração ao vivo.",
  wa_link: "https://crm.funilpersia.top/chat/abc123",
  agent_name: "Recepção",
  handoff_reason: "cliente pediu falar com humano",
} as const;

interface Props {
  draftEnabled: boolean;
  draftTargetType: HandoffNotificationTargetType | null;
  draftTargetAddress: string;
  draftTemplate: string;
  onEnabledChange: (v: boolean) => void;
  onTargetTypeChange: (v: HandoffNotificationTargetType) => void;
  onTargetAddressChange: (v: string) => void;
  onTemplateChange: (v: string) => void;
}

export function HandoffNotificationCard({
  draftEnabled,
  draftTargetType,
  draftTargetAddress,
  draftTemplate,
  onEnabledChange,
  onTargetTypeChange,
  onTargetAddressChange,
  onTemplateChange,
}: Props) {
  const effectiveTemplate = draftTemplate.trim() || HANDOFF_DEFAULT_TEMPLATE;
  const phoneDigits = draftTargetAddress.replace(/\D/g, "");
  const phoneInvalid =
    draftEnabled &&
    draftTargetType === "phone" &&
    (phoneDigits.length < HANDOFF_PHONE_MIN_DIGITS ||
      phoneDigits.length > HANDOFF_PHONE_MAX_DIGITS);
  const addressMissing = draftEnabled && !draftTargetAddress.trim();
  const templateTooLong = draftTemplate.length > HANDOFF_TEMPLATE_MAX_LENGTH;

  const placeholders = React.useMemo(
    () => listTemplatePlaceholders(draftTemplate),
    [draftTemplate],
  );
  const unknownPlaceholders = placeholders.filter((p) => !isKnownTemplateVariable(p));
  const preview = renderHandoffTemplate(effectiveTemplate, PREVIEW_VARIABLES);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BellRing className="size-4 text-primary" />
          Notificação de handoff
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Quando o agente transferir a conversa pra humano (`stop_agent`), dispara uma mensagem WhatsApp pra equipe via a mesma conexao que recebeu o lead.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3 pb-3 border-b">
          <div className="flex-1 min-w-0">
            <Label htmlFor="handoff_enabled" className="cursor-pointer">
              Ativar notificação
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Quando desligado, o agente ainda pausa, mas ninguém é avisado automaticamente.
            </p>
          </div>
          <Switch
            id="handoff_enabled"
            checked={draftEnabled}
            onCheckedChange={(v) => onEnabledChange(Boolean(v))}
          />
        </div>

        {draftEnabled ? (
          <>
            <div className="space-y-2">
              <Label>Tipo de destino</Label>
              <div className="flex gap-2">
                <TargetTypeButton
                  active={draftTargetType === "phone"}
                  icon={Phone}
                  label="Telefone"
                  onClick={() => onTargetTypeChange("phone")}
                />
                <TargetTypeButton
                  active={draftTargetType === "group"}
                  icon={Users}
                  label="Grupo"
                  onClick={() => onTargetTypeChange("group")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="handoff_address">
                {draftTargetType === "group" ? "JID do grupo" : "Número de telefone"}
              </Label>
              <Input
                id="handoff_address"
                value={draftTargetAddress}
                onChange={(e) => onTargetAddressChange(e.target.value)}
                placeholder={
                  draftTargetType === "group"
                    ? "Ex: 120363027489123456@g.us"
                    : "Ex: 5511999999999"
                }
                aria-invalid={phoneInvalid || addressMissing}
              />
              {draftTargetType === "phone" ? (
                <p className="text-xs text-muted-foreground">
                  Digite o número completo com código do país e DDD. {HANDOFF_PHONE_MIN_DIGITS}–{HANDOFF_PHONE_MAX_DIGITS} dígitos.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  JID do grupo no formato <code>1203...@g.us</code>. Copie do UAZAPI ou do WhatsApp Business.
                </p>
              )}
              {addressMissing ? (
                <p className="text-xs text-destructive">Destino é obrigatório quando a notificação está ativa.</p>
              ) : null}
              {phoneInvalid ? (
                <p className="text-xs text-destructive">
                  Telefone deve ter entre {HANDOFF_PHONE_MIN_DIGITS} e {HANDOFF_PHONE_MAX_DIGITS} dígitos.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="handoff_template">Template da mensagem</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onTemplateChange(HANDOFF_DEFAULT_TEMPLATE)}
                  className="h-7"
                >
                  <RotateCcw className="size-3" />
                  Usar template padrão
                </Button>
              </div>
              <Textarea
                id="handoff_template"
                value={draftTemplate}
                onChange={(e) => onTemplateChange(e.target.value)}
                placeholder={HANDOFF_DEFAULT_TEMPLATE}
                rows={7}
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground mr-1">Variaveis disponíveis:</span>
                {HANDOFF_TEMPLATE_VARIABLES.map((variable) => (
                  <VariableChip
                    key={variable}
                    name={variable}
                    used={placeholders.includes(variable)}
                    onClick={() => onTemplateChange(`${draftTemplate}{{${variable}}}`)}
                  />
                ))}
              </div>
              {unknownPlaceholders.length > 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                  <Info className="size-3.5 shrink-0 mt-0.5" />
                  Placeholders desconhecidos serão renderizados vazios:{" "}
                  {unknownPlaceholders.map((p) => `{{${p}}}`).join(", ")}
                </p>
              ) : null}
              {templateTooLong ? (
                <p className="text-xs text-destructive">
                  Template excede {HANDOFF_TEMPLATE_MAX_LENGTH} caracteres ({draftTemplate.length}).
                </p>
              ) : null}
              <p className="text-[11px] text-muted-foreground/70 tabular-nums">
                {draftTemplate.length}/{HANDOFF_TEMPLATE_MAX_LENGTH} caracteres
              </p>
            </div>

            <div className="space-y-2 pt-3 border-t">
              <div className="flex items-center gap-2">
                <Eye className="size-3.5 text-muted-foreground" />
                <Label className="text-xs font-medium">Pré-visualização com dados de exemplo</Label>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <div className="size-7 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <MessageSquare className="size-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-muted-foreground mb-1">
                      Para:{" "}
                      <span className="font-mono">
                        {draftTargetAddress || "(destino não configurado)"}
                      </span>
                    </p>
                    <pre className="text-xs whitespace-pre-wrap font-sans text-foreground leading-relaxed">
                      {preview}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TargetTypeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors flex-1",
        active
          ? "border-primary bg-primary/5 text-foreground"
          : "border-input text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function VariableChip({
  name,
  used,
  onClick,
}: {
  name: string;
  used: boolean;
  onClick: () => void;
}) {
  return (
    <Badge
      variant={used ? "default" : "outline"}
      className={cn(
        "text-[10px] font-mono cursor-pointer transition-opacity",
        used ? "opacity-100" : "opacity-70 hover:opacity-100",
      )}
      onClick={onClick}
    >
      {`{{${name}}}`}
    </Badge>
  );
}
