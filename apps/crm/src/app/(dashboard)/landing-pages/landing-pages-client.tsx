"use client";

import * as React from "react";
import {
  Plus,
  Trash2,
  Globe,
  GlobeOff,
  Eye,
  MousePointerClick,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createLandingPage,
  deleteLandingPage,
  toggleLandingPagePublished,
} from "@/actions/landing-pages";

interface LandingPage {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cta_text: string;
  cta_type: string;
  is_published: boolean;
  visits: number;
  conversions: number;
  created_at: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function LandingPagesClient({
  initialPages,
}: {
  initialPages: LandingPage[];
}) {
  const [pages, setPages] = React.useState<LandingPage[]>(initialPages);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [title, setTitle] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [ctaText, setCtaText] = React.useState("Saiba mais");
  const [ctaType, setCtaType] = React.useState("whatsapp");

  function openCreateDialog() {
    setTitle("");
    setSlug("");
    setDescription("");
    setCtaText("Saiba mais");
    setCtaType("whatsapp");
    setCreateOpen(true);
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    setSlug(slugify(value));
  }

  async function handleCreate() {
    if (!title.trim() || !slug.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("title", title.trim());
      fd.set("slug", slug.trim());
      fd.set("description", description);
      fd.set("cta_text", ctaText);
      fd.set("cta_type", ctaType);
      const newPage = await createLandingPage(fd);
      if (newPage) {
        setPages((prev) => [newPage as LandingPage, ...prev]);
      }
      setCreateOpen(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePublished(page: LandingPage) {
    setSaving(true);
    try {
      await toggleLandingPagePublished(page.id, !page.is_published);
      setPages((prev) =>
        prev.map((p) =>
          p.id === page.id ? { ...p, is_published: !p.is_published } : p
        )
      );
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir esta landing page?")) return;
    setSaving(true);
    try {
      await deleteLandingPage(id);
      setPages((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreateDialog}>
          <Plus className="size-4" />
          Nova Landing Page
        </Button>
      </div>

      {pages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhuma landing page</p>
            <p className="text-sm text-muted-foreground">
              Crie páginas de captura para seus leads
            </p>
            <Button className="mt-4" onClick={openCreateDialog}>
              <Plus className="size-4" />
              Criar primeira página
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pages.map((page) => (
            <Card key={page.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 min-w-0 flex-1">
                    <CardTitle className="text-base truncate">
                      {page.title}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground font-mono">
                      /{page.slug}
                    </p>
                  </div>
                  <Badge
                    variant={page.is_published ? "default" : "secondary"}
                    className="ml-2 shrink-0"
                  >
                    {page.is_published ? "Publicada" : "Rascunho"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {page.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {page.description}
                  </p>
                )}
                <div className="flex gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Eye className="size-3.5" />
                    <span>{page.visits} visitas</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MousePointerClick className="size-3.5" />
                    <span>{page.conversions} conversoes</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTogglePublished(page)}
                    disabled={saving}
                    className="flex-1"
                  >
                    {page.is_published ? (
                      <>
                        <GlobeOff className="size-3.5" />
                        Despublicar
                      </>
                    ) : (
                      <>
                        <Globe className="size-3.5" />
                        Publicar
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => handleDelete(page.id)}
                    disabled={saving}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Landing Page</DialogTitle>
            <DialogDescription>
              Configure os dados da página de captura
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lp-title">Título</Label>
              <Input
                id="lp-title"
                placeholder="Ex: Consultoria Gratuita"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lp-slug">Slug (URL)</Label>
              <Input
                id="lp-slug"
                placeholder="consultoria-gratuita"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                URL: seudominio.com/{slug || "slug"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lp-desc">Descrição (opcional)</Label>
              <Textarea
                id="lp-desc"
                rows={3}
                placeholder="Descreva a página..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lp-cta-text">Texto do CTA</Label>
                <Input
                  id="lp-cta-text"
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo do CTA</Label>
                <Select
                  value={ctaType}
                  onValueChange={(v) => setCtaType(v ?? "whatsapp")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="form">Formulario</SelectItem>
                    <SelectItem value="link">Link Externo</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              onClick={handleCreate}
              disabled={saving || !title.trim() || !slug.trim()}
            >
              {saving ? "Criando..." : "Criar Pagina"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
