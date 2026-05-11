"use client";

// PR-S1: tab de comentarios colaborativos extraida do drawer CRM
// pra packages/leads-ui. Compartilhada entre apps/crm (drawer) e
// apps/admin (lead detail page).
//
// DI: as 4 actions de CRUD vem via useLeadsActions() — caller (cada
// app) injeta sua implementacao via <LeadsProvider>. O componente
// nao importa @/actions/* — pacote agnostico ao app.
//
// Graceful degradation: se uma das 4 actions for undefined no provider
// (ex: admin nao implementa write yet), a UI esconde o feature
// correspondente. Read-only: passar so getLeadComments.
//
// Pegadinhas tratadas:
//   - Auth de quem pode editar/deletar e RLS server-side (action falha
//     com erro permission denied -> toast)
//   - Refetch on bump (PR-P realtime) via prop reloadVersion opcional

import * as React from "react";
import { toast } from "sonner";
import {
  Loader2,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { Textarea } from "@persia/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { useLeadsActions } from "../context";
import type { LeadComment } from "../actions";

export interface LeadCommentsTabMember {
  user_id: string;
  name: string;
}

export interface LeadCommentsTabProps {
  leadId: string;
  open: boolean;
  members: LeadCommentsTabMember[];
  /**
   * PR-P: bump incrementado por hooks de realtime no caller pra
   * forcar refetch. Opcional — quando undefined, so refetcha em open.
   */
  reloadVersion?: number;
  /**
   * Quando true, esconde o form de novo comentario + acoes edit/delete
   * (admin v1 — audit, sem write). Default false.
   */
  readOnly?: boolean;
}

export function LeadCommentsTab({
  leadId,
  open,
  members,
  reloadVersion = 0,
  readOnly = false,
}: LeadCommentsTabProps) {
  const actions = useLeadsActions();
  const canCreate = !readOnly && !!actions.createLeadComment;
  const canEdit = !readOnly && !!actions.updateLeadComment;
  const canDelete = !readOnly && !!actions.deleteLeadComment;

  const [comments, setComments] = React.useState<LeadComment[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [newContent, setNewContent] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingContent, setEditingContent] = React.useState("");
  const [savingEdit, setSavingEdit] = React.useState(false);

  const reload = React.useCallback(async () => {
    if (!actions.getLeadComments) {
      setComments([]);
      return;
    }
    setLoading(true);
    try {
      const res = await actions.getLeadComments(leadId);
      setComments(res);
    } catch (err) {
      console.error("[LeadCommentsTab] failed:", err);
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [leadId, actions]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    reload().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [open, reload]);

  // Refetch quando o pai bumpa reloadVersion (realtime).
  React.useEffect(() => {
    if (!open || reloadVersion === 0) return;
    void reload();
  }, [reloadVersion, open, reload]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent.trim() || submitting || !actions.createLeadComment) return;
    setSubmitting(true);
    try {
      const created = await actions.createLeadComment(leadId, newContent);
      setComments((prev) => [...prev, created]);
      setNewContent("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao criar comentário",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(commentId: string) {
    if (!editingContent.trim() || savingEdit || !actions.updateLeadComment)
      return;
    setSavingEdit(true);
    try {
      await actions.updateLeadComment(commentId, editingContent);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                content: editingContent.trim(),
                updated_at: new Date().toISOString(),
              }
            : c,
        ),
      );
      setEditingId(null);
      setEditingContent("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(commentId: string) {
    if (!actions.deleteLeadComment) return;
    if (typeof window !== "undefined" && !window.confirm("Excluir este comentário?"))
      return;
    try {
      await actions.deleteLeadComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    }
  }

  return (
    <div className="space-y-4">
      {/* Lista de comentarios */}
      {loading ? (
        <div className="space-y-2 py-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 w-full bg-muted rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <MessageSquare className="size-5 mx-auto mb-2 text-muted-foreground/60" />
          <p className="font-medium text-foreground">
            Nenhum comentário ainda
          </p>
          <p className="mt-1 text-xs">
            {canCreate
              ? "Use comentários internos para passar contexto entre agentes sobre este lead. Mencione um colega com @nome."
              : "Os comentários internos da equipe aparecem aqui."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              members={members}
              canEdit={canEdit}
              canDelete={canDelete}
              isEditing={editingId === c.id}
              editingContent={editingContent}
              savingEdit={savingEdit}
              onStartEdit={() => {
                setEditingId(c.id);
                setEditingContent(c.content);
              }}
              onChangeEdit={setEditingContent}
              onCancelEdit={() => {
                setEditingId(null);
                setEditingContent("");
              }}
              onSaveEdit={() => handleSaveEdit(c.id)}
              onDelete={() => handleDelete(c.id)}
            />
          ))}
        </ul>
      )}

      {/* Form criar — esconde se readOnly ou actions.createLeadComment ausente */}
      {canCreate && (
        <form
          onSubmit={handleCreate}
          className="space-y-2 rounded-lg border border-border bg-card p-3"
        >
          <Textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value.slice(0, 2000))}
            placeholder="Escreva um comentário interno... Use @nome para mencionar um colega."
            rows={3}
            maxLength={2000}
            className="resize-none border-0 focus-visible:ring-0 bg-transparent text-sm p-0"
            disabled={submitting}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground/70">
              {newContent.length}/2000 · só visível pra equipe
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={!newContent.trim() || submitting}
              className="h-8 rounded-md gap-1.5"
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Comentar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// Item individual de comentario com edit/delete inline.
function CommentItem({
  comment,
  members,
  canEdit,
  canDelete,
  isEditing,
  editingContent,
  savingEdit,
  onStartEdit,
  onChangeEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  comment: LeadComment;
  members: LeadCommentsTabMember[];
  canEdit: boolean;
  canDelete: boolean;
  isEditing: boolean;
  editingContent: string;
  savingEdit: boolean;
  onStartEdit: () => void;
  onChangeEdit: (v: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  const authorName = comment.author_name?.trim() || "Autor desconhecido";
  const initials = authorName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  const avatarColor = React.useMemo(() => {
    const palette = [
      "bg-blue-500",
      "bg-emerald-500",
      "bg-amber-500",
      "bg-rose-500",
      "bg-violet-500",
      "bg-cyan-500",
    ];
    const seed = authorName
      .split("")
      .reduce((a, c) => a + c.charCodeAt(0), 0);
    return palette[seed % palette.length];
  }, [authorName]);

  const isEdited = comment.updated_at !== comment.created_at;
  const showMenu = canEdit || canDelete;

  return (
    <li className="flex gap-2.5 rounded-lg p-2.5 hover:bg-muted/40 transition-colors group">
      <span
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ${avatarColor}`}
        aria-hidden
      >
        {initials || "?"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground">
            {authorName}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatRelativeShort(comment.created_at)}
            {isEdited && " · editado"}
          </span>
          {showMenu && !isEditing && (
            <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                      aria-label="Mais opções"
                    >
                      ⋯
                    </button>
                  }
                />
                <DropdownMenuContent align="end" className="w-32">
                  {canEdit && (
                    <DropdownMenuItem onClick={onStartEdit}>
                      <Pencil className="size-3.5" />
                      Editar
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={onDelete}
                    >
                      <Trash2 className="size-3.5" />
                      Excluir
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="mt-1 space-y-1">
            <Textarea
              value={editingContent}
              onChange={(e) => onChangeEdit(e.target.value.slice(0, 2000))}
              rows={3}
              maxLength={2000}
              className="resize-none text-sm"
              disabled={savingEdit}
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancelEdit}
                disabled={savingEdit}
                className="h-7"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSaveEdit}
                disabled={!editingContent.trim() || savingEdit}
                className="h-7"
              >
                {savingEdit ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-sm text-foreground whitespace-pre-wrap break-words">
            {renderCommentContent(comment.content, members)}
          </p>
        )}
      </div>
    </li>
  );
}

// Renderiza @mencoes como badges visuais.
function renderCommentContent(
  content: string,
  members: LeadCommentsTabMember[],
): React.ReactNode {
  const memberFirstNames = new Set(
    members
      .map((m) => (m.name || "").split(/\s+/)[0]?.toLowerCase())
      .filter(Boolean),
  );

  const parts: React.ReactNode[] = [];
  const regex = /(?:^|(?<=\s))@([\p{L}\p{N}_]+)/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before) parts.push(before);
    const mention = match[1];
    const isKnown = memberFirstNames.has(mention.toLowerCase());
    parts.push(
      <span
        key={`m-${key++}`}
        className={`inline-flex items-center rounded px-1 ${
          isKnown
            ? "bg-primary/10 text-primary font-medium"
            : "bg-muted text-muted-foreground"
        }`}
      >
        @{mention}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  const after = content.slice(lastIndex);
  if (after) parts.push(after);
  return parts.length > 0 ? parts : content;
}

function formatRelativeShort(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const month = Math.floor(day / 30);
  return `${month}mes`;
}
