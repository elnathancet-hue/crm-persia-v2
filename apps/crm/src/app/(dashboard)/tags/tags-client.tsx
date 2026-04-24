"use client";

import * as React from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@persia/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { TagBadge } from "@/components/tags/tag-badge";
import { createTag, updateTag, deleteTag } from "@/actions/tags";
import { useRole } from "@/lib/hooks/use-role";

interface Tag {
  id: string;
  name: string;
  color: string;
  organization_id: string;
  created_at: string;
  lead_count: number;
}

const COLOR_GRID = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7",
  "#d946ef", "#ec4899", "#f43f5e", "#64748b",
];

interface TagsPageClientProps {
  initialTags: Tag[];
}

export function TagsPageClient({ initialTags }: TagsPageClientProps) {
  const { isAgent, isAdmin } = useRole(); // agent+ can create/edit; admin+ can delete
  const [tags, setTags] = React.useState<Tag[]>(initialTags);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [editingTag, setEditingTag] = React.useState<Tag | null>(null);
  const [deletingTag, setDeletingTag] = React.useState<Tag | null>(null);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("#6366f1");
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function openCreateDialog() {
    setEditingTag(null);
    setName("");
    setColor("#6366f1");
    setErrors({});
    setDialogOpen(true);
  }

  function openEditDialog(tag: Tag) {
    setEditingTag(tag);
    setName(tag.name);
    setColor(tag.color);
    setDialogOpen(true);
  }

  function openDeleteDialog(tag: Tag) {
    setDeletingTag(tag);
    setDeleteDialogOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) { setError("tag_name", "Campo obrigatório"); return; }
    clearError("tag_name");
    setSaving(true);
    try {
      if (editingTag) {
        await updateTag(editingTag.id, { name: name.trim(), color });
        setTags((prev) =>
          prev.map((t) =>
            t.id === editingTag.id ? { ...t, name: name.trim(), color } : t
          )
        );
      } else {
        const newTag = await createTag({ name: name.trim(), color });
        if (newTag) {
          setTags((prev) => [
            { ...newTag, lead_count: 0 } as Tag,
            ...prev,
          ]);
        }
      }
      setDialogOpen(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingTag) return;
    setSaving(true);
    try {
      await deleteTag(deletingTag.id);
      setTags((prev) => prev.filter((t) => t.id !== deletingTag.id));
      setDeleteDialogOpen(false);
      setDeletingTag(null);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {isAgent && (
        <div className="flex justify-end">
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            Nova Tag
          </Button>
        </div>
      )}

      {tags.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
          <div className="rounded-full bg-muted p-3">
            <Plus className="size-6 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-base font-medium">Nenhuma tag criada</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie tags para organizar seus leads
          </p>
          {isAgent && (
            <Button className="mt-4" onClick={openCreateDialog}>
              <Plus className="size-4" />
              Criar primeira tag
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="group flex items-center justify-between rounded-xl border bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="size-4 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">{tag.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {tag.lead_count} {tag.lead_count === 1 ? "lead" : "leads"}
                  </p>
                </div>
              </div>
              {(isAgent || isAdmin) && (
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {isAgent && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEditDialog(tag)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openDeleteDialog(tag)}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingTag ? "Editar Tag" : "Nova Tag"}</DialogTitle>
            <DialogDescription>
              {editingTag
                ? "Altere o nome ou a cor da tag"
                : "Crie uma nova tag para organizar seus leads"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Nome *</Label>
              <Input
                id="tag-name"
                placeholder="Ex: Cliente VIP"
                value={name}
                onChange={(e) => { setName(e.target.value); clearError("tag_name"); }}
                onBlur={() => { if (!name.trim()) setError("tag_name", "Campo obrigatório"); else clearError("tag_name"); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                className={errors.tag_name ? "border-destructive focus-visible:ring-destructive/50" : ""}
              />
              {errors.tag_name && <p className="text-xs text-destructive mt-1">{errors.tag_name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="grid grid-cols-8 gap-2">
                {COLOR_GRID.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="size-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? "#000" : "transparent",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Preview</Label>
              <div>
                <TagBadge name={name || "Tag"} color={color} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? "Salvando..." : editingTag ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Tag</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a tag{" "}
              <strong>{deletingTag?.name}</strong>? Ela sera removida de todos os
              leads.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={saving}
            >
              {saving ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
