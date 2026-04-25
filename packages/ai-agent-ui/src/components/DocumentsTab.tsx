"use client";

import * as React from "react";
import {
  FileText,
  Loader2,
  RefreshCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_UPLOAD_MAX_BYTES,
  type AgentKnowledgeSource,
  type KnowledgeSourceMetadata,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { useAgentActions } from "../context";
import { IndexingStatusBadge } from "./IndexingStatusBadge";

interface Props {
  configId: string;
  sources: AgentKnowledgeSource[];
  onChange: (sources: AgentKnowledgeSource[]) => void;
  onRefresh: () => Promise<void>;
}

type DocMetadata = Extract<KnowledgeSourceMetadata, { storage_path: string }>;

const MAX_MB = Math.round(DOCUMENT_UPLOAD_MAX_BYTES / 1024 / 1024);
const ACCEPT_ATTRIBUTE = DOCUMENT_ALLOWED_MIME_TYPES.join(",");

export function DocumentsTab({
  configId,
  sources,
  onChange,
  onRefresh,
}: Props) {
  const { uploadDocument, deleteKnowledgeSource, reindexKnowledgeSource } =
    useAgentActions();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const docs = sources.filter((s) => s.source_type === "document");

  const resetDialog = () => {
    setTitle("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openUpload = () => {
    resetDialog();
    setDialogOpen(true);
  };

  const acceptFile = (picked: File | null) => {
    if (!picked) {
      setFile(null);
      return;
    }
    if (picked.size > DOCUMENT_UPLOAD_MAX_BYTES) {
      toast.error(`Arquivo excede ${MAX_MB}MB`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!DOCUMENT_ALLOWED_MIME_TYPES.includes(picked.type as never)) {
      toast.error("Formato não permitido. Use PDF, DOCX ou TXT.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(picked);
    if (!title) {
      setTitle(stripExtension(picked.name));
    }
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0] ?? null);
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    if (dropped) acceptFile(dropped);
  };

  const handleDragOver = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const clearSelectedFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUpload = () => {
    if (!file) {
      toast.error("Selecione um arquivo");
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Informe um título");
      return;
    }

    const formData = new FormData();
    formData.append("title", trimmedTitle);
    formData.append("file", file);

    startTransition(async () => {
      try {
        const created = await uploadDocument(configId, formData);
        onChange([created, ...sources]);
        toast.success("Upload concluído — indexação em fila");
        setDialogOpen(false);
        resetDialog();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha no upload");
      }
    });
  };

  const handleDelete = (source: AgentKnowledgeSource) => {
    if (
      !window.confirm(
        `Apagar "${source.title}"? O arquivo sai do armazenamento e todos os chunks indexados são removidos.`,
      )
    ) {
      return;
    }
    setDeletingId(source.id);
    startTransition(async () => {
      try {
        await deleteKnowledgeSource(source.id);
        onChange(sources.filter((s) => s.id !== source.id));
        toast.success("Documento removido");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover");
      } finally {
        setDeletingId(null);
      }
    });
  };

  const handleReindex = (source: AgentKnowledgeSource) => {
    startTransition(async () => {
      try {
        const updated = await reindexKnowledgeSource(source.id);
        onChange(sources.map((s) => (s.id === updated.id ? updated : s)));
        toast.success("Re-indexação enfileirada");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao reindexar");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            <h2 className="font-semibold">Documentos da base</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Faça upload de PDFs, DOCX ou TXT. O conteúdo é fatiado e indexado
            para que o agente recupere os trechos relevantes em cada conversa.
            Limite {MAX_MB}MB por arquivo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void onRefresh();
            }}
            disabled={isPending}
          >
            <RefreshCcw className="size-4" />
            Atualizar
          </Button>
          <Button onClick={openUpload} disabled={isPending}>
            <Upload className="size-4" />
            Enviar documento
          </Button>
        </div>
      </div>

      {docs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
              <FileText className="size-6 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-1">
              <p className="font-semibold text-sm">Adicione a base de conhecimento</p>
              <p className="text-xs text-muted-foreground">
                Suba PDFs, DOCX ou TXT com o conteúdo que o agente deve consultar.
                Etapas com base de conhecimento ativa recuperam os trechos relevantes
                automaticamente em cada resposta.
              </p>
            </div>
            <Button onClick={openUpload}>
              <Upload className="size-4" />
              Enviar primeiro documento
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {docs.map((source) => {
            const meta = source.metadata as DocMetadata;
            return (
              <Card key={source.id} className="transition-shadow hover:shadow-sm">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm truncate tracking-tight">
                          {source.title}
                        </p>
                        <IndexingStatusBadge
                          status={source.indexing_status}
                          error={source.indexing_error}
                          chunkCount={source.chunk_count}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {meta.original_filename}
                        {" · "}
                        {formatBytes(meta.size_bytes)}
                        {" · "}
                        {mimeTypeLabel(meta.mime_type)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {source.indexing_status === "failed" ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-10"
                          aria-label="Reindexar"
                          onClick={() => handleReindex(source)}
                          disabled={isPending}
                        >
                          <RefreshCcw className="size-4" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        aria-label="Apagar"
                        onClick={() => handleDelete(source)}
                        disabled={isPending}
                      >
                        {deletingId === source.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetDialog();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar documento</DialogTitle>
            <DialogDescription>
              PDF, DOCX ou TXT até {MAX_MB}MB. A indexação roda em segundo plano
              e pode levar alguns segundos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="doc-title">Título</Label>
              <Input
                id="doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Manual de onboarding"
                disabled={isPending}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-file">Arquivo</Label>
              <input
                ref={fileInputRef}
                id="doc-file"
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                onChange={handleFileInput}
                disabled={isPending}
                className="sr-only"
                aria-describedby="doc-file-description"
              />
              {file ? (
                <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
                  <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <FileText className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)} · {mimeTypeLabel(file.type)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-9"
                    onClick={clearSelectedFile}
                    disabled={isPending}
                    aria-label="Remover arquivo"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  disabled={isPending}
                  id="doc-file-description"
                  className={
                    "flex flex-col items-center justify-center gap-2 w-full rounded-xl border-2 border-dashed py-10 px-6 transition-colors " +
                    (isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40 hover:bg-muted/30") +
                    " disabled:opacity-50 disabled:cursor-not-allowed"
                  }
                >
                  <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
                    <Upload className="size-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {isDragging ? "Solte o arquivo aqui" : "Clique ou arraste um arquivo"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PDF, DOCX ou TXT até {MAX_MB}MB
                    </p>
                  </div>
                </button>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                resetDialog();
              }}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleUpload} disabled={isPending || !file}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function mimeTypeLabel(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "DOCX";
  }
  if (mime === "text/plain") return "TXT";
  return mime;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
