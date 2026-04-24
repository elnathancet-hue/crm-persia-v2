"use client";

import * as React from "react";
import {
  Plus,
  FileText,
  ImageIcon,
  Film,
  File,
  Trash2,
  Copy,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Power,
  PowerOff,
  Search,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Badge } from "@persia/ui/badge";
import { Card, CardContent } from "@persia/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@persia/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { createTool, updateTool, deleteTool } from "@/actions/tools";
import { toast } from "sonner";

interface Tool {
  id: string;
  name: string;
  description: string | null;
  category: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
  slug: string | null;
  is_active: boolean;
  usage_count: number;
  created_at: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  documento: { label: "Documento", icon: FileText, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  imagem: { label: "Imagem", icon: ImageIcon, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  video: { label: "Video", icon: Film, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
  outro: { label: "Outro", icon: File, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function detectCategory(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "imagem";
  if (mimeType.startsWith("video/")) return "video";
  return "documento";
}

export function ToolsClient({ initialTools }: { initialTools: Tool[] }) {
  const [tools, setTools] = React.useState<Tool[]>(initialTools);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [filterCat, setFilterCat] = React.useState("all");

  // Upload form
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState("documento");
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  function openUpload() {
    setName("");
    setDescription("");
    setCategory("documento");
    setSelectedFile(null);
    setUploadOpen(true);
  }

  async function handleUpload() {
    if (!name.trim() || !selectedFile) {
      toast.error("Preencha nome e selecione um arquivo");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("description", description.trim());
      fd.set("category", category);
      fd.set("file", selectedFile);
      const newTool = await createTool(fd);
      if (newTool) setTools((prev) => [newTool as Tool, ...prev]);
      toast.success("Tool adicionada!");
      setUploadOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteTool(id);
      setTools((prev) => prev.filter((t) => t.id !== id));
      toast.success("Tool removida");
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
  }

  async function handleToggle(tool: Tool) {
    try {
      await updateTool(tool.id, { is_active: !tool.is_active });
      setTools((prev) => prev.map((t) => (t.id === tool.id ? { ...t, is_active: !t.is_active } : t)));
    } catch {}
  }

  function copyApiUrl(tool: Tool) {
    const url = `${window.location.origin}/api/tools?orgId=ORG_ID&slug=${tool.slug}`;
    navigator.clipboard.writeText(url);
    toast.success("URL da API copiada!");
  }

  const filtered = tools.filter((t) => {
    if (filterCat !== "all" && t.category !== filterCat) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      {/* Top bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar tool..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={filterCat} onValueChange={(v) => setFilterCat(v ?? "all")}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="documento">Documentos</SelectItem>
            <SelectItem value="imagem">Imagens</SelectItem>
            <SelectItem value="video">Videos</SelectItem>
            <SelectItem value="outro">Outros</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={openUpload} className="ml-auto">
          <Plus className="size-4" />
          Nova Tool
        </Button>
      </div>

      {/* API info */}
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong>API para n8n:</strong>{" "}
        <code className="bg-muted px-1.5 py-0.5 rounded">GET /api/tools?orgId=SEU_ORG_ID&slug=nome-do-arquivo</code>
        {" "}→ retorna <code className="bg-muted px-1.5 py-0.5 rounded">file_url</code> para usar no WhatsApp <code className="bg-muted px-1.5 py-0.5 rounded">/send/media</code>
      </div>

      {/* Tools list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="size-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <FileText className="size-7 text-muted-foreground/60" />
            </div>
            <p className="text-base font-semibold">Nenhuma tool</p>
            <p className="text-sm text-muted-foreground mt-1">
              Adicione imagens, PDFs e documentos para usar nas automacoes
            </p>
            <Button className="mt-4" onClick={openUpload}>
              <Plus className="size-4" />
              Adicionar primeira tool
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((tool) => {
            const cat = CATEGORY_CONFIG[tool.category] || CATEGORY_CONFIG.outro;
            const CatIcon = cat.icon;
            const isImage = tool.file_type.startsWith("image/");

            return (
              <Card key={tool.id} className="hover:border-primary/30 transition-colors overflow-hidden">
                {/* Image preview */}
                {isImage && (
                  <div className="h-32 bg-muted/30 flex items-center justify-center overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={tool.file_url} alt={tool.name} loading="lazy" className="h-full w-full object-cover" />
                  </div>
                )}

                <CardContent className={`${isImage ? "p-3" : "p-4"}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {!isImage && (
                        <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${cat.color}`}>
                          <CatIcon className="size-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{tool.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="secondary" className={`text-[9px] px-1.5 ${cat.color}`}>
                            {cat.label}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{formatFileSize(tool.file_size)}</span>
                        </div>
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <Button variant="ghost" size="icon-sm" className="size-7 shrink-0">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => window.open(tool.file_url, "_blank")}>
                          <ExternalLink className="size-4" />
                          Abrir arquivo
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => copyApiUrl(tool)}>
                          <Copy className="size-4" />
                          Copiar URL da API
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggle(tool)}>
                          {tool.is_active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                          {tool.is_active ? "Desativar" : "Ativar"}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => handleDelete(tool.id)}>
                          <Trash2 className="size-4" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {tool.description && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{tool.description}</p>
                  )}

                  <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                    <span>{tool.file_name}</span>
                    {tool.usage_count > 0 && (
                      <span className="ml-auto">{tool.usage_count}x usado</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Tool</DialogTitle>
            <DialogDescription>
              Adicione um arquivo que podera ser enviado pela IA ou pelo agente
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input placeholder="Ex: Cardápio, Proposta Comercial" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input placeholder="Breve descrição do arquivo" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={category} onValueChange={(v) => setCategory(v ?? "documento")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="documento">Documento</SelectItem>
                  <SelectItem value="imagem">Imagem</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Arquivo</Label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.pptx,.zip"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setSelectedFile(f);
                    if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
                    setCategory(detectCategory(f.type));
                  }
                }}
                className="w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
              />
              {selectedFile && (
                <p className="text-xs text-muted-foreground">
                  {selectedFile.name} ({formatFileSize(selectedFile.size)})
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleUpload} disabled={uploading || !name.trim() || !selectedFile}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {uploading ? "Enviando..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
