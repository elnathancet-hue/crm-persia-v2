"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Save, Zap } from "lucide-react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Badge } from "@persia/ui/badge";
import { Switch } from "@persia/ui/switch";
import { Textarea } from "@persia/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { updateFlow } from "@/actions/flows";

interface Flow {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config: any;
  is_active: boolean;
  nodes: any[];
  edges: any[];
  created_at: string;
  updated_at: string;
}

export function FlowEditorClient({ flow }: { flow: Flow }) {
  const [name, setName] = React.useState(flow.name);
  const [triggerType, setTriggerType] = React.useState(flow.trigger_type);
  const [isActive, setIsActive] = React.useState(flow.is_active);
  const [nodesJson, setNodesJson] = React.useState(
    JSON.stringify(flow.nodes || [], null, 2)
  );
  const [edgesJson, setEdgesJson] = React.useState(
    JSON.stringify(flow.edges || [], null, 2)
  );
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  function validateJson() {
    try {
      JSON.parse(nodesJson);
      JSON.parse(edgesJson);
      setJsonError(null);
      return true;
    } catch (e: any) {
      setJsonError(e.message);
      return false;
    }
  }

  async function handleSave() {
    if (!validateJson()) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateFlow(flow.id, {
        name: name.trim(),
        trigger_type: triggerType,
        is_active: isActive,
        nodes: JSON.parse(nodesJson),
        edges: JSON.parse(edgesJson),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(checked: boolean) {
    setIsActive(checked);
    try {
      await updateFlow(flow.id, { is_active: checked });
    } catch {
      setIsActive(!checked);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/flows">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight font-heading">{name || "Sem nome"}</h1>
              <Badge variant={isActive ? "default" : "secondary"}>
                {isActive ? "Ativo" : "Inativo"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Criado em {new Date(flow.created_at).toLocaleDateString("pt-BR")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="flow-active" className="text-sm">
              Ativo
            </Label>
            <Switch
              id="flow-active"
              checked={isActive}
              onCheckedChange={handleToggleActive}
            />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="size-4" />
            {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
          </Button>
        </div>
      </div>

      {/* Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configurações do Fluxo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="flow-name">Nome</Label>
              <Input
                id="flow-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Gatilho</Label>
              <Select
                value={triggerType}
                onValueChange={(v) => setTriggerType(v ?? "manual")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="lead_created">Lead Criado</SelectItem>
                  <SelectItem value="lead_updated">Lead Atualizado</SelectItem>
                  <SelectItem value="tag_added">Tag Adicionada</SelectItem>
                  <SelectItem value="message_received">Mensagem Recebida</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="size-4" />
              Informacoes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ID</span>
              <span className="font-mono text-xs">{flow.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nos</span>
              <span>{(flow.nodes || []).length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Conexoes</span>
              <span>{(flow.edges || []).length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Atualizado</span>
              <span>
                {flow.updated_at
                  ? new Date(flow.updated_at).toLocaleDateString("pt-BR")
                  : "-"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* JSON Editor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Editor de Nos e Conexoes (JSON)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Edite os nos e conexoes do fluxo em formato JSON. Um editor visual sera adicionado em breve.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {jsonError && (
            <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
              JSON invalido: {jsonError}
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nos (nodes)</Label>
              <Textarea
                className="font-mono text-xs min-h-[300px]"
                value={nodesJson}
                onChange={(e) => {
                  setNodesJson(e.target.value);
                  setJsonError(null);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Conexoes (edges)</Label>
              <Textarea
                className="font-mono text-xs min-h-[300px]"
                value={edgesJson}
                onChange={(e) => {
                  setEdgesJson(e.target.value);
                  setJsonError(null);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
