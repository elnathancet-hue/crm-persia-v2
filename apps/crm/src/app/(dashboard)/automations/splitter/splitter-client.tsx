"use client";

import * as React from "react";
import { Loader2, Save, Scissors, Info } from "lucide-react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Switch } from "@persia/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@persia/ui/card";
import { updateAssistant } from "@/actions/ai";

interface MessageSplitting {
  enabled: boolean;
  threshold: number;
  delay_seconds: number;
}

interface Assistant {
  id: string;
  message_splitting: MessageSplitting | null;
  [key: string]: unknown;
}

interface SplitterClientProps {
  initialAssistant: Assistant | null;
}

export function SplitterClient({ initialAssistant }: SplitterClientProps) {
  const [enabled, setEnabled] = React.useState(initialAssistant?.message_splitting?.enabled ?? false);
  const [threshold, setThreshold] = React.useState(String(initialAssistant?.message_splitting?.threshold ?? 100));
  const [delay, setDelay] = React.useState(String(initialAssistant?.message_splitting?.delay_seconds ?? 2));
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  async function handleSave() {
    if (!initialAssistant?.id) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateAssistant(initialAssistant.id, {
        message_splitting: {
          enabled,
          threshold: parseInt(threshold) || 100,
          delay_seconds: parseFloat(delay) || 2,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  if (!initialAssistant) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Info className="size-5" />
            <p className="text-sm">
              Configure o Assistente IA primeiro antes de usar o picotador.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scissors className="size-5" />
            Como funciona
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Quando a IA gera uma resposta longa, o picotador divide automaticamente
              em mensagens curtas e naturais - como se fosse uma pessoa digitando no WhatsApp.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <p className="font-medium text-foreground mb-1">1. IA responde</p>
                <p className="text-xs">A IA gera a resposta completa normalmente</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium text-foreground mb-1">2. Picotador divide</p>
                <p className="text-xs">Se a resposta for longa, é dividida em partes naturais</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium text-foreground mb-1">3. Envio com delay</p>
                <p className="text-xs">Cada parte é enviada com um intervalo, simulando digitação</p>
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
                Ative e configure o comportamento do picotador
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {enabled ? "Ativo" : "Inativo"}
              </span>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
        </CardHeader>
        {enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="threshold">Tamanho minimo (caracteres)</Label>
                <Input
                  id="threshold"
                  type="number"
                  min="50"
                  max="500"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Mensagens menores que esse valor nao serao divididas. Recomendado: 100
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="delay">Delay entre mensagens (segundos)</Label>
                <Input
                  id="delay"
                  type="number"
                  min="1"
                  max="10"
                  step="0.5"
                  value={delay}
                  onChange={(e) => setDelay(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Tempo de espera entre cada mensagem. Recomendado: 2 segundos
                </p>
              </div>
            </div>
          </CardContent>
        )}
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
          <span className="text-sm text-green-600">Salvo com sucesso!</span>
        )}
      </div>
    </div>
  );
}
