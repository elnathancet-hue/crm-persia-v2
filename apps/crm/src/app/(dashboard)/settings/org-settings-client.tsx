"use client";

import * as React from "react";
import { Save, Loader2, Bot } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateOrgSettings } from "@/actions/organization";
import { toast } from "sonner";

interface AiContext {
  product: string;
  target_audience: string;
  sales_goal: string;
  restrictions: string;
  key_info: string;
}

export function OrgSettingsClient({
  orgId,
  initialName,
  initialNiche,
  initialWebsite,
  plan,
  initialAiContext,
}: {
  orgId: string;
  initialName: string;
  initialNiche: string;
  initialWebsite: string;
  plan: string;
  initialAiContext?: AiContext;
}) {
  const [name, setName] = React.useState(initialName);
  const [niche, setNiche] = React.useState(initialNiche);
  const [website, setWebsite] = React.useState(initialWebsite);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // AI Context
  const [product, setProduct] = React.useState(initialAiContext?.product || "");
  const [targetAudience, setTargetAudience] = React.useState(initialAiContext?.target_audience || "");
  const [salesGoal, setSalesGoal] = React.useState(initialAiContext?.sales_goal || "");
  const [restrictions, setRestrictions] = React.useState(initialAiContext?.restrictions || "");
  const [keyInfo, setKeyInfo] = React.useState(initialAiContext?.key_info || "");

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  async function handleSave() {
    if (!name.trim()) { setError("org_name", "Campo obrigatório"); return; }
    clearError("org_name");
    setSaving(true);
    try {
      await updateOrgSettings({
        _org_name: name,
        _org_niche: niche,
        _org_website: website,
        ai_context: {
          product: product.trim() || null,
          target_audience: targetAudience.trim() || null,
          sales_goal: salesGoal.trim() || null,
          restrictions: restrictions.trim() || null,
          key_info: keyInfo.trim() || null,
        },
      });
      toast.success("Dados salvos!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Dados da Organização</CardTitle>
            <Badge>{plan}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome da empresa *</Label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); clearError("org_name"); }}
                onBlur={() => { if (!name.trim()) setError("org_name", "Campo obrigatório"); else clearError("org_name"); }}
                className={errors.org_name ? "border-destructive focus-visible:ring-destructive/50" : ""}
              />
              {errors.org_name && <p className="text-xs text-destructive mt-1">{errors.org_name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Nicho</Label>
              <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Ex: Estética, Educação..." />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Website</Label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Context */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="size-5 text-primary" />
            <CardTitle className="text-lg">Contexto para IA</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Informações que a IA usa para atender seus leads com mais precisão
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Produto / Serviço</Label>
              <Input
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                placeholder="Ex: Curso de Identificação Humana"
              />
            </div>
            <div className="space-y-2">
              <Label>Público-alvo</Label>
              <Input
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="Ex: Profissionais de segurança pública"
              />
            </div>
            <div className="space-y-2">
              <Label>Objetivo do atendimento</Label>
              <Input
                value={salesGoal}
                onChange={(e) => setSalesGoal(e.target.value)}
                placeholder="Ex: Matricular o lead no curso"
              />
            </div>
            <div className="space-y-2">
              <Label>Informações-chave</Label>
              <Input
                value={keyInfo}
                onChange={(e) => setKeyInfo(e.target.value)}
                placeholder="Ex: 15 módulos, 12 meses, 360h, EAD ao vivo"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Restrições</Label>
            <Textarea
              value={restrictions}
              onChange={(e) => setRestrictions(e.target.value)}
              placeholder="Ex: Nunca improvise preço. Nunca prometa aprovação em concursos."
              className="min-h-[60px]"
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} size="sm">
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        {saving ? "Salvando..." : "Salvar"}
      </Button>
    </div>
  );
}
