"use client";

import * as React from "react";
import { Globe, Info, Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentTool,
  CreateCustomWebhookToolInput,
  JSONSchemaObject,
} from "@persia/shared/ai-agent";
import { WEBHOOK_SECRET_MIN_LENGTH } from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
import { useAgentActions } from "../context";

interface Props {
  configId: string;
  allowedDomains: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (tool: AgentTool) => void;
}

const DEFAULT_SCHEMA: JSONSchemaObject = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Texto que o agente quer mandar pro webhook.",
    },
  },
};

export function CustomWebhookToolSheet({
  configId,
  allowedDomains,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const { createCustomWebhookTool } = useAgentActions();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [schemaText, setSchemaText] = React.useState(
    JSON.stringify(DEFAULT_SCHEMA, null, 2),
  );
  const [schemaError, setSchemaError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setUrl("");
      setSecret("");
      setSchemaText(JSON.stringify(DEFAULT_SCHEMA, null, 2));
      setSchemaError(null);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let schema: JSONSchemaObject;
    try {
      const parsed = JSON.parse(schemaText) as unknown;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { type?: unknown }).type !== "object" ||
        !(parsed as { properties?: unknown }).properties
      ) {
        throw new Error("Schema deve ser um objeto com type='object' e properties");
      }
      schema = parsed as JSONSchemaObject;
      setSchemaError(null);
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : "JSON inválido");
      return;
    }

    const input: CreateCustomWebhookToolInput = {
      config_id: configId,
      name: name.trim(),
      description: description.trim(),
      webhook_url: url.trim(),
      webhook_secret: secret,
      input_schema: schema,
    };

    startTransition(async () => {
      try {
        const created = await createCustomWebhookTool(input);
        onCreated(created);
        toast.success("Webhook adicionado");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao criar webhook");
      }
    });
  };

  const canSubmit =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    url.trim().length > 0 &&
    secret.length >= WEBHOOK_SECRET_MIN_LENGTH &&
    schemaText.trim().length > 0 &&
    !isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Globe className="size-4 text-primary" />
            <SheetTitle>Webhook customizado</SheetTitle>
          </div>
          <SheetDescription>
            Integra o agente com um endpoint HTTPS externo (n8n, Make, API própria). A requisição leva HMAC sha256 + timestamp; respostas sao limitadas a 256 KB.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto space-y-4 px-4"
          id="custom-webhook-form"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Nome da ferramenta</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: criar_negocio_no_crm_externo"
              required
            />
            <p className="text-xs text-muted-foreground">
              Este é o nome que o agente enxerga pra decidir chamar a ferramenta. Use snake_case.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição (pra o agente)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explique pro agente quando usar essa ferramenta."
              rows={3}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">URL HTTPS</Label>
            <Input
              id="url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://n8n.sua-empresa.com.br/webhook/abc"
              required
            />
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0 mt-0.5 text-emerald-600" />
              O hostname precisa estar na allowlist da organização. Apenas HTTPS porta 443.
            </p>
            {allowedDomains.length > 0 ? (
              <div className="text-[11px] text-muted-foreground">
                Domínios liberados:{" "}
                <span className="font-mono">{allowedDomains.join(", ")}</span>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret">Secret HMAC</Label>
            <Input
              id="secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={`No mínimo ${WEBHOOK_SECRET_MIN_LENGTH} caracteres`}
              required
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Cada requisição leva <code className="font-mono">X-Persia-Signature: sha256=...</code> calculado com este secret + timestamp. Configure o mesmo no receptor pra validar.
            </p>
            {secret.length > 0 && secret.length < WEBHOOK_SECRET_MIN_LENGTH ? (
              <p className="text-xs text-destructive">
                Faltam {WEBHOOK_SECRET_MIN_LENGTH - secret.length} caractere(s).
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="schema">Schema de entrada (JSON)</Label>
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              Define os argumentos que o agente passa pro webhook. Compatível com JSON Schema do Anthropic tool-use.
            </p>
            <Textarea
              id="schema"
              value={schemaText}
              onChange={(e) => {
                setSchemaText(e.target.value);
                setSchemaError(null);
              }}
              rows={10}
              className="font-mono text-xs"
              required
            />
            {schemaError ? (
              <p className="text-xs text-destructive">{schemaError}</p>
            ) : null}
          </div>
        </form>

        <SheetFooter className="flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" form="custom-webhook-form" disabled={!canSubmit}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Criar webhook
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
