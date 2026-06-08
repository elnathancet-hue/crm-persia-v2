"use client";

import * as React from "react";
import {
  Code2,
  GitBranch,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { Checkbox } from "@persia/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@persia/ui/table";
import {
  createCaptureSource,
  updateCaptureSource,
  deleteCaptureSource,
  type CaptureSourceRow,
  type CreateCaptureSourceInput,
} from "@/actions/capture-sources";
import type { ApiKeyRow } from "@/actions/api-keys";

// ============================================================================
// Types
// ============================================================================

interface Pipeline {
  id: string;
  name: string;
}

interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Props {
  initialSources: CaptureSourceRow[];
  apiKeys: ApiKeyRow[];
  pipelines: Pipeline[];
  allStages: Stage[];
  tags: Tag[];
}

// ============================================================================
// Helpers
// ============================================================================

const CRM_HOST = "https://crm.funilpersia.top";

function buildSnippet(sourceId: string) {
  return `<!-- Cole antes do </body> no seu site -->
<!-- Substitua pk_live_... pela chave de API completa (disponível só na criação) -->
<script
  src="${CRM_HOST}/capture.js"
  data-source-id="${sourceId}"
  data-api-key="pk_live_SUA_CHAVE_AQUI"
></script>`;
}

function buildFetchExample(sourceId: string) {
  return `// Integração manual via fetch (sem script embed):
fetch('${CRM_HOST}/api/leads/inbound', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'pk_live_SUA_CHAVE_AQUI'
  },
  body: JSON.stringify({
    source_id: '${sourceId}',
    name: 'João Silva',
    phone: '11999999999',
    email: 'joao@email.com',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'campanha-principal'
  })
})`;
}

// ============================================================================
// Snippet dialog
// ============================================================================

function SnippetDialog({
  source,
  onClose,
}: {
  source: CaptureSourceRow;
  onClose: () => void;
}) {
  const [copiedSnippet, setCopiedSnippet] = React.useState(false);
  const [copiedFetch, setCopiedFetch] = React.useState(false);
  const snippet = buildSnippet(source.id);
  const fetchExample = buildFetchExample(source.id);

  function copy(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true);
      setTimeout(() => setter(false), 2000);
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="size-5" />
            Snippet — {source.name}
          </DialogTitle>
          <DialogDescription>
            Cole o script no site ou use a API diretamente com a chave vinculada a esta origem.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Script embed */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Script embed</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(snippet, setCopiedSnippet)}
              >
                {copiedSnippet ? "Copiado!" : "Copiar"}
              </Button>
            </div>
            <pre className="rounded-lg bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
              {snippet}
            </pre>
          </div>

          {/* Fetch example */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Integração via fetch</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(fetchExample, setCopiedFetch)}
              >
                {copiedFetch ? "Copiado!" : "Copiar"}
              </Button>
            </div>
            <pre className="rounded-lg bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
              {fetchExample}
            </pre>
          </div>

          <p className="text-xs text-muted-foreground">
            ID da origem:{" "}
            <code className="bg-muted px-1 py-0.5 rounded font-mono">{source.id}</code>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Create / Edit sheet
// ============================================================================

interface FormState {
  name: string;
  api_key_id: string;
  pipeline_id: string;
  stage_id: string;
  tag_ids: string[];
  dedup_window_hours: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  api_key_id: "",
  pipeline_id: "",
  stage_id: "",
  tag_ids: [],
  dedup_window_hours: "24",
};

function SourceSheet({
  source,
  apiKeys,
  pipelines,
  allStages,
  tags,
  onSaved,
  onClose,
}: {
  source: CaptureSourceRow | null; // null = create mode
  apiKeys: ApiKeyRow[];
  pipelines: Pipeline[];
  allStages: Stage[];
  tags: Tag[];
  onSaved: (record: CaptureSourceRow) => void;
  onClose: () => void;
}) {
  const isEdit = source !== null;

  const [form, setForm] = React.useState<FormState>(() =>
    source
      ? {
          name: source.name,
          api_key_id: source.api_key_id,
          pipeline_id: source.pipeline_id ?? "",
          stage_id: source.stage_id ?? "",
          tag_ids: source.tag_ids ?? [],
          dedup_window_hours: String(source.dedup_window_hours ?? 24),
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = React.useState(false);

  // Stages filtered by selected pipeline
  const filteredStages = form.pipeline_id
    ? allStages.filter((s) => s.pipeline_id === form.pipeline_id)
    : [];

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Reset stage when pipeline changes
      if (key === "pipeline_id") next.stage_id = "";
      return next;
    });
  }

  function toggleTag(tagId: string) {
    setForm((prev) => ({
      ...prev,
      tag_ids: prev.tag_ids.includes(tagId)
        ? prev.tag_ids.filter((id) => id !== tagId)
        : [...prev.tag_ids, tagId],
    }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (!form.api_key_id) {
      toast.error("Selecione uma chave de API");
      return;
    }

    const dedupHours = parseInt(form.dedup_window_hours, 10);
    if (isNaN(dedupHours) || dedupHours < 0) {
      toast.error("Janela de dedup inválida");
      return;
    }

    setSaving(true);
    try {
      const input: CreateCaptureSourceInput = {
        name: form.name.trim(),
        api_key_id: form.api_key_id,
        pipeline_id: form.pipeline_id || null,
        stage_id: form.stage_id || null,
        tag_ids: form.tag_ids,
        dedup_window_hours: dedupHours,
      };

      if (isEdit) {
        const res = await updateCaptureSource(source.id, input);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        // Merge updated fields into source for optimistic update
        onSaved({ ...source, ...input, api_key_prefix: source.api_key_prefix });
      } else {
        const res = await createCaptureSource(input);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        onSaved(res.record);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border bg-card p-5">
          <DialogTitle className="sr-only">
            {isEdit ? "Editar origem" : "Nova origem de captura"}
          </DialogTitle>
          <DialogHero
            icon={<Globe className="size-5" />}
            title={isEdit ? "Editar origem" : "Nova origem de captura"}
            tagline={isEdit ? "Altere as configurações da origem" : "Configure uma nova fonte de leads"}
          />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Identificação */}
          <section className="space-y-3">
            <header className="space-y-0.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Globe className="size-4 text-muted-foreground" />
                Identificação
              </h3>
              <p className="text-xs text-muted-foreground pl-6">
                Nome e chave de API vinculada a esta origem
              </p>
            </header>

            <div className="space-y-1">
              <Label htmlFor="source-name" className="text-xs text-muted-foreground">Nome</Label>
              <Input
                id="source-name"
                name="source_name"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="Ex: Site principal, LP Black Friday"
                maxLength={100}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Chave de API</Label>
              {apiKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma chave ativa. Crie uma em{" "}
                  <a href="/settings/api-keys" className="underline">
                    Configurações → API
                  </a>
                  .
                </p>
              ) : (
                <Select
                  value={form.api_key_id}
                  onValueChange={(v) => { if (v) setField("api_key_id", v); }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a chave de API" />
                  </SelectTrigger>
                  <SelectContent>
                    {apiKeys.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.name}{" "}
                        <span className="text-muted-foreground font-mono text-xs">
                          ({k.key_prefix}...)
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </section>

          {/* Roteamento */}
          <section className="space-y-3">
            <header className="space-y-0.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <GitBranch className="size-4 text-muted-foreground" />
                Roteamento
              </h3>
              <p className="text-xs text-muted-foreground pl-6">
                Para qual funil e etapa o lead entra automaticamente
              </p>
            </header>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Funil (opcional)</Label>
              <Select
                value={form.pipeline_id || "__none__"}
                onValueChange={(v) => setField("pipeline_id", !v || v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sem funil definido" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem funil (triagem manual)</SelectItem>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.pipeline_id && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Etapa inicial (opcional)</Label>
                <Select
                  value={form.stage_id || "__first__"}
                  onValueChange={(v) => setField("stage_id", !v || v === "__first__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Primeira etapa do funil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__first__">Primeira etapa do funil</SelectItem>
                    {filteredStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </section>

          {/* Automação */}
          <section className="space-y-3">
            <header className="space-y-0.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Tag className="size-4 text-muted-foreground" />
                Automação
              </h3>
              <p className="text-xs text-muted-foreground pl-6">
                Aplicadas automaticamente em cada lead capturado por esta origem
              </p>
            </header>

            {tags.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Tags automáticas (opcional)</Label>
                <div className="max-h-36 overflow-y-auto rounded-lg border p-2 space-y-1">
                  {tags.map((tag) => (
                    <label
                      key={tag.id}
                      className="flex items-center gap-2 px-1 py-0.5 rounded cursor-pointer hover:bg-muted"
                    >
                      <Checkbox
                        checked={form.tag_ids.includes(tag.id)}
                        onCheckedChange={() => toggleTag(tag.id)}
                      />
                      <span
                        className="size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="text-sm">{tag.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="dedup-hours" className="text-xs text-muted-foreground">
                Janela de deduplicação (horas)
              </Label>
              <Input
                id="dedup-hours"
                name="dedup_window_hours"
                type="number"
                min="0"
                max="720"
                value={form.dedup_window_hours}
                onChange={(e) => setField("dedup_window_hours", e.target.value)}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Se o mesmo telefone submeter dentro deste período, o lead não é duplicado.
                Use 0 para desativar.
              </p>
            </div>
          </section>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? "Salvar alterações" : "Criar origem"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Main client
// ============================================================================

export function CaptureSourcesClient({
  initialSources,
  apiKeys,
  pipelines,
  allStages,
  tags,
}: Props) {
  const [sources, setSources] = React.useState<CaptureSourceRow[]>(initialSources);
  const [sheetSource, setSheetSource] = React.useState<CaptureSourceRow | null | undefined>(
    undefined, // undefined = closed; null = create; CaptureSourceRow = edit
  );
  const [snippetSource, setSnippetSource] = React.useState<CaptureSourceRow | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  function openCreate() {
    setSheetSource(null);
  }

  function openEdit(source: CaptureSourceRow) {
    setSheetSource(source);
  }

  function handleSaved(record: CaptureSourceRow) {
    setSources((prev) => {
      const exists = prev.some((s) => s.id === record.id);
      if (exists) return prev.map((s) => (s.id === record.id ? record : s));
      return [record, ...prev];
    });
    setSheetSource(undefined);
    toast.success(sheetSource === null ? "Origem criada." : "Origem atualizada.");
  }

  async function handleDelete(source: CaptureSourceRow) {
    if (!confirm(`Excluir a origem "${source.name}"? Formulários vinculados a ela pararão de funcionar.`)) return;

    setDeleting(source.id);
    try {
      const res = await deleteCaptureSource(source.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success("Origem excluída.");
    } finally {
      setDeleting(null);
    }
  }

  // Build a pipeline name lookup
  const pipelineMap = React.useMemo(
    () => Object.fromEntries(pipelines.map((p) => [p.id, p.name])),
    [pipelines],
  );
  const stageMap = React.useMemo(
    () => Object.fromEntries(allStages.map((s) => [s.id, s.name])),
    [allStages],
  );
  const tagMap = React.useMemo(
    () => Object.fromEntries(tags.map((t) => [t.id, t])),
    [tags],
  );

  return (
    <>
      {/* Sheet */}
      {sheetSource !== undefined && (
        <SourceSheet
          source={sheetSource}
          apiKeys={apiKeys}
          pipelines={pipelines}
          allStages={allStages}
          tags={tags}
          onSaved={handleSaved}
          onClose={() => setSheetSource(undefined)}
        />
      )}

      {/* Snippet dialog */}
      {snippetSource && (
        <SnippetDialog
          source={snippetSource}
          onClose={() => setSnippetSource(null)}
        />
      )}

      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Cada origem gera um snippet único com{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">source_id</code>{" "}
            para rastrear de onde cada lead veio — site, landing page, anúncio, parceiro.
          </p>
          <Button onClick={openCreate} size="sm" className="shrink-0">
            <Plus className="mr-2 size-4" />
            Criar origem
          </Button>
        </div>

        {/* Content */}
        {sources.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <Globe className="size-8 text-muted-foreground/50" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Nenhuma origem cadastrada</p>
                <p className="text-xs text-muted-foreground">
                  Crie uma origem para conectar formulários externos ao CRM.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={openCreate}>
                <Plus className="mr-2 size-4" />
                Criar primeira origem
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Chave de API</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Dedup</TableHead>
                  <TableHead className="w-[120px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => {
                  const pipelineName = source.pipeline_id ? pipelineMap[source.pipeline_id] : null;
                  const stageName = source.stage_id ? stageMap[source.stage_id] : null;
                  const tagCount = source.tag_ids?.length ?? 0;
                  const tagList = (source.tag_ids ?? [])
                    .map((id) => tagMap[id])
                    .filter(Boolean);

                  return (
                    <TableRow key={source.id}>
                      <TableCell className="font-medium">{source.name}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                          {source.api_key_prefix}...
                        </code>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {pipelineName ? (
                          <>
                            {pipelineName}
                            {stageName && (
                              <span className="text-muted-foreground/60"> → {stageName}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground/50">Sem funil</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {tagCount === 0 ? (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {tagList.slice(0, 3).map((tag) => (
                              <Badge
                                key={tag.id}
                                variant="secondary"
                                className="text-xs"
                                style={{ borderLeftColor: tag.color, borderLeftWidth: 3 }}
                              >
                                {tag.name}
                              </Badge>
                            ))}
                            {tagCount > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{tagCount - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {source.dedup_window_hours === 0
                          ? "Desativado"
                          : `${source.dedup_window_hours}h`}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setSnippetSource(source)}
                            aria-label="Ver snippet"
                            title="Ver snippet"
                          >
                            <Code2 className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEdit(source)}
                            aria-label="Editar"
                            title="Editar origem"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            onClick={() => handleDelete(source)}
                            disabled={deleting === source.id}
                            aria-label="Excluir"
                            title="Excluir origem"
                          >
                            {deleting === source.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
