"use client";

// Tab "Comentarios" do drawer "Informacoes do lead" (Fase 4).
// Lista comentarios internos do time, permite criar/deletar.
// Edicao inline pode ser adicionada depois — por hora so create + delete.

import * as React from "react";
import { toast } from "sonner";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import type { LeadCommentWithAuthor } from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import { Textarea } from "@persia/ui/textarea";
import {
  createLeadComment,
  deleteLeadComment,
  getLeadComments,
} from "@/actions/lead-comments";

interface Props {
  leadId: string;
  /** Reabre quando o drawer abre (forca refetch) */
  active: boolean;
}

const MAX = 5000;

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function LeadCommentsTab({ leadId, active }: Props) {
  const [comments, setComments] = React.useState<LeadCommentWithAuthor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    getLeadComments(leadId)
      .then((rows) => {
        if (!cancelled) setComments(rows);
      })
      .catch((err) => {
        if (!cancelled)
          toast.error(
            err instanceof Error ? err.message : "Erro ao carregar comentarios",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, active]);

  function handleCreate() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX) {
      toast.error(`Comentário excede ${MAX} caracteres`);
      return;
    }

    startTransition(async () => {
      try {
        const created = await createLeadComment({
          lead_id: leadId,
          body: trimmed,
        });
        setComments((prev) => [created, ...prev]);
        setDraft("");
        toast.success("Comentário publicado");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Erro ao publicar",
        );
      }
    });
  }

  function handleDelete(id: string) {
    const previous = comments;
    setComments((prev) => prev.filter((c) => c.id !== id));
    startTransition(async () => {
      try {
        await deleteLeadComment(id);
        toast.success("Comentário removido");
      } catch (err) {
        setComments(previous);
        toast.error(
          err instanceof Error ? err.message : "Erro ao remover",
        );
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Form de novo comentario */}
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escreva um comentário interno sobre este lead..."
          rows={3}
          maxLength={MAX}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {draft.length}/{MAX} caracteres
          </p>
          <Button
            type="button"
            size="sm"
            onClick={handleCreate}
            disabled={isPending || !draft.trim()}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Publicar
          </Button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <MessageSquare className="mx-auto size-6 mb-2 opacity-60" />
          Nenhum comentário ainda. Seja o primeiro a anotar algo.
        </div>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border bg-card p-3 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="size-6 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center text-xs font-semibold">
                    {(c.author?.full_name ?? "?")[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-medium">
                      {c.author?.full_name ?? "Usuário removido"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatRelativeDate(c.created_at)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(c.id)}
                  disabled={isPending}
                  title="Remover comentário"
                >
                  <Trash2 className="size-3.5 text-destructive/70" />
                </Button>
              </div>
              <p className="text-sm whitespace-pre-wrap pl-8">{c.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
