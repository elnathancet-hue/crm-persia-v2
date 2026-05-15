"use client";

import * as React from "react";
import { Loader2, Save, Webhook, ExternalLink, Info, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";
import { updateOrgSettings } from "@/actions/organization";

interface WebhookClientProps {
  orgId: string;
  initialWebhookUrl: string;
}

export function WebhookClient({ orgId, initialWebhookUrl }: WebhookClientProps) {
  const [webhookUrl, setWebhookUrl] = React.useState(initialWebhookUrl);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<"ok" | "error" | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await updateOrgSettings({ n8n_webhook_url: webhookUrl.trim() || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!webhookUrl.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(webhookUrl.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone: "5500000000000",
          identificador: "test:test",
          query: "Mensagem de teste do CRM Persia",
          leadName: "Teste",
          leadId: "test",
          orgId,
          messageType: "text",
        }),
      });
      setTestResult(res.ok ? "ok" : "error");
    } catch {
      setTestResult("error");
    } finally {
      setTesting(false);
    }
  }

  const isConfigured = Boolean(webhookUrl.trim());

  return (
    <div className="space-y-6">
      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="size-5" />
            Como funciona
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Quando um lead envia uma mensagem no WhatsApp, o CRM Persia envia os dados para
              o webhook configurado. Sua IA externa (n8n, Make, etc.) processa e retorna a resposta.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <p className="font-medium text-foreground mb-1">1. Lead envia</p>
                <p className="text-xs">Mensagem chega pelo WhatsApp</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium text-foreground mb-1">2. CRM envia</p>
                <p className="text-xs">Dados são enviados para seu webhook</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium text-foreground mb-1">3. IA processa</p>
                <p className="text-xs">Sua IA gera a resposta</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium text-foreground mb-1">4. Resposta</p>
                <p className="text-xs">CRM envia a resposta pelo WhatsApp</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Config */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Configuração</CardTitle>
              <CardDescription>
                Cole a URL do webhook da sua automação
              </CardDescription>
            </div>
            <Badge variant={isConfigured ? "default" : "secondary"}>
              {isConfigured ? "Configurado" : "Não configurado"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">URL do Webhook</Label>
            <Input
              id="webhook-url"
              type="url"
              placeholder="https://seu-n8n.com/webhook/crm-persia-ai"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              O CRM envia um POST com: telefone, identificador, query, leadName, leadId, orgId
            </p>
          </div>

          {/* Test button */}
          {isConfigured && (
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
                {testing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ExternalLink className="size-4" />
                )}
                Testar Conexão
              </Button>
              {testResult === "ok" && (
                <div className="flex items-center gap-1 text-sm text-success">
                  <CheckCircle2 className="size-4" />
                  Webhook respondeu com sucesso
                </div>
              )}
              {testResult === "error" && (
                <div className="flex items-center gap-1 text-sm text-destructive">
                  <XCircle className="size-4" />
                  Erro na conexão. Verifique a URL
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payload info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="size-5" />
            Formato do Payload
          </CardTitle>
          <CardDescription>
            O webhook recebe um POST com o seguinte JSON
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="rounded-lg bg-muted p-4 text-xs overflow-x-auto">
{`{
  "telefone": "5586999999999",
  "identificador": "orgId:leadId",
  "query": "Mensagem do lead",
  "leadName": "Nome do Lead",
  "leadId": "uuid-do-lead",
  "conversationId": "uuid-da-conversa",
  "orgId": "uuid-da-organizacao",
  "messageType": "text"
}`}
          </pre>
          <p className="text-xs text-muted-foreground mt-3">
            O webhook deve retornar: <code className="bg-muted px-1.5 py-0.5 rounded">{`{ "output": "Resposta da IA" }`}</code>
          </p>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {saving ? "Salvando..." : "Salvar"}
        </Button>
        {saved && (
          <span className="text-sm text-success">Salvo com sucesso!</span>
        )}
      </div>
    </div>
  );
}
