"use client";

// TagsList — view de listagem de tags compartilhada entre CRM (cliente)
// e Admin (superadmin). Auth/role moram nos apps; o pacote recebe
// permissoes (canCreate/canEdit/canDelete) via props e actions via
// <TagsProvider>.
//
// Originalmente em apps/crm/src/app/(dashboard)/tags/tags-client.tsx
// (~282 linhas). Extraido pra resolver drift visual (admin estava com
// HTML cru + Tailwind custom).
//
// === Sprint 2 (refactor arquitetural) =====================================
// Migrado pra pattern padronizado:
//   - useDialogMutation (resolve "modal nao fecha apos save")
//   - actions retornam ActionResult { data?, error? } | void
//   - toast.success/error com id estavel + duration 5000
//   - Erros antes silenciados ("// silently fail") agora viram toast
// Referencias: packages/ui/docs/patterns.md  +  PR #178
// ==========================================================================

import * as React from "react";
import { Plus, Pencil, Trash2, MoreHorizontal, Tag as TagIcon } from "lucide-react";
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
import { useDialogMutation, ActionMenu, EmptyState } from "@persia/ui";
import type { TagWithCount } from "@persia/shared/crm";

import { TagBadge } from "./TagBadge";
import { useTagsActions } from "../context";

const COLOR_GRID = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#64748b",
];

export interface TagsListProps {
  initialTags: TagWithCount[];
  /** agent+: pode criar/editar tags. */
  canCreate: boolean;
  canEdit: boolean;
  /** admin+: pode deletar tags. */
  canDelete: boolean;
}

export function TagsList({
  initialTags,
  canCreate,
  canEdit,
  canDelete,
}: TagsListProps) {
  const actions = useTagsActions();
  const [tags, setTags] = React.useState<TagWithCount[]>(initialTags);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [editingTag, setEditingTag] = React.useState<TagWithCount | null>(null);
  const [deletingTag, setDeletingTag] =
    React.useState<TagWithCount | null>(null);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("#6366f1");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Sync com prop quando o pai re-fetcha (router.refresh).
  React.useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  function setError(field: string, msg: string) {
    setErrors((prev) => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors((prev) => {
      const n = { ...prev };
      delete n[field];
      return n;
    });
  }

  function openCreateDialog() {
    setEditingTag(null);
    setName("");
    setColor("#6366f1");
    setErrors({});
    setDialogOpen(true);
  }

  function openEditDialog(tag: TagWithCount) {
    setEditingTag(tag);
    setName(tag.name);
    setColor(tag.color);
    setErrors({});
    setDialogOpen(true);
  }

  function openDeleteDialog(tag: TagWithCount) {
    setDeletingTag(tag);
    setDeleteDialogOpen(true);
  }

  // -----------------------------------------------------------------------
  // Mutations padronizadas
  // -----------------------------------------------------------------------

  const saveMutation = useDialogMutation<
    { mode: "create" | "update"; name: string; color: string; tagId?: string }
  >({
    mutation: async (input) => {
      if (input.mode === "update" && input.tagId) {
        const result = await actions.updateTag(input.tagId, {
          name: input.name,
          color: input.color,
        });
        return result;
      }
      return actions.createTag({ name: input.name, color: input.color });
    },
    onOpenChange: setDialogOpen,
    successToast: (data) => {
      // data eh Tag quando create; void quando update.
      return data ? "Tag criada" : "Tag atualizada";
    },
    errorToast: (err) => err,
    toastId: "tag-save",
    onSuccess: (data) => {
      // Optimistic local update — mantem UX rapida sem precisar de
      // router.refresh extra (a action ja faz revalidatePath).
      if (editingTag) {
        setTags((prev) =>
          prev.map((t) =>
            t.id === editingTag.id ? { ...t, name, color } : t,
          ),
        );
      } else if (data && typeof data === "object" && "id" in data) {
        const newTag = data as { id: string; name: string; color: string };
        setTags((prev) => [
          { ...newTag, lead_count: 0 } as TagWithCount,
          ...prev,
        ]);
      }
    },
  });

  const deleteMutation = useDialogMutation<{ tagId: string }>({
    mutation: ({ tagId }) => actions.deleteTag(tagId),
    onOpenChange: setDeleteDialogOpen,
    successToast: "Tag excluída",
    errorToast: (err) => err,
    toastId: "tag-delete",
    onSuccess: () => {
      if (deletingTag) {
        setTags((prev) => prev.filter((t) => t.id !== deletingTag.id));
        setDeletingTag(null);
      }
    },
  });

  function handleSave() {
    if (!name.trim()) {
      setError("tag_name", "Campo obrigatório");
      return;
    }
    clearError("tag_name");
    saveMutation.run({
      mode: editingTag ? "update" : "create",
      tagId: editingTag?.id,
      name: name.trim(),
      color,
    });
  }

  function handleDelete() {
    if (!deletingTag) return;
    deleteMutation.run({ tagId: deletingTag.id });
  }

  const saving = saveMutation.pending;
  const deleting = deleteMutation.pending;

  return (
    <>
      {canCreate && (
        <div className="flex justify-end">
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            Nova Tag
          </Button>
        </div>
      )}

      {tags.length === 0 ? (
        <EmptyState
          tone="primary"
          icon={<TagIcon />}
          title="Nenhuma tag criada"
          description="Crie tags para organizar e segmentar seus leads (ex: Cliente VIP, Aguardando proposta, Reativar)."
          action={
            canCreate ? (
              <Button onClick={openCreateDialog}>
                <Plus className="size-4" />
                Criar primeira tag
              </Button>
            ) : null
          }
        />
      ) : (
        // PR-A (mai/2026): card com border-left accent na cor da tag +
        // dot pequeno + kebab sempre visivel. Pattern do mockup ChatGPT
        // — "cor = informacao, nao decoracao". Antes era card branco
        // homogeneo com dot grande + Pencil/Trash so no hover (acoes
        // invisiveis a maior parte do tempo).
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="group flex items-center justify-between rounded-xl border-l-4 border-y border-r border-y-border border-r-border bg-card p-4 transition-colors hover:bg-muted/30"
              style={{ borderLeftColor: tag.color }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{tag.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {tag.lead_count}{" "}
                    {tag.lead_count === 1 ? "lead" : "leads"}
                  </p>
                </div>
              </div>
              {(canEdit || canDelete) && (
                <ActionMenu
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Ações da tag ${tag.name}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                >
                  {canEdit && (
                    <ActionMenu.Item
                      icon={Pencil}
                      onClick={() => openEditDialog(tag)}
                    >
                      Editar
                    </ActionMenu.Item>
                  )}
                  {canDelete && (
                    <ActionMenu.Destructive
                      icon={Trash2}
                      onClick={() => openDeleteDialog(tag)}
                    >
                      Excluir
                    </ActionMenu.Destructive>
                  )}
                </ActionMenu>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl w-[92vw] sm:max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTag ? "Editar Tag" : "Nova Tag"}
            </DialogTitle>
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
                name="tag_name"
                placeholder="Ex: Cliente VIP"
                value={name}
                aria-invalid={Boolean(errors.tag_name)}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError("tag_name");
                }}
                onBlur={() => {
                  if (!name.trim())
                    setError("tag_name", "Campo obrigatório");
                  else clearError("tag_name");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                className={
                  errors.tag_name
                    ? "border-destructive focus-visible:ring-destructive/50"
                    : ""
                }
              />
              {errors.tag_name && (
                <p className="text-xs text-destructive mt-1">
                  {errors.tag_name}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="grid grid-cols-8 gap-2">
                {COLOR_GRID.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Cor ${c}`}
                    aria-pressed={color === c}
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
        <DialogContent className="rounded-2xl w-[92vw] sm:max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Excluir Tag</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a tag{" "}
              <strong>{deletingTag?.name}</strong>? Ela será removida de
              todos os leads.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
