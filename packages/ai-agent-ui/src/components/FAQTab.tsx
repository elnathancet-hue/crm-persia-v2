"use client";

import * as React from "react";
import {
  HelpCircle,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  FAQ_ANSWER_MAX_CHARS,
  FAQ_QUESTION_MAX_CHARS,
  type AgentKnowledgeSource,
  type KnowledgeSourceMetadata,
} from "@persia/shared/ai-agent";
import { Badge } from "@persia/ui/badge";
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
import { Textarea } from "@persia/ui/textarea";
import { useAgentActions } from "../context";
import { IndexingStatusBadge } from "./IndexingStatusBadge";

interface Props {
  configId: string;
  sources: AgentKnowledgeSource[];
  onChange: (sources: AgentKnowledgeSource[]) => void;
  onRefresh: () => Promise<void>;
}

type FAQMetadata = Extract<KnowledgeSourceMetadata, { question: string }>;

interface EditorState {
  open: boolean;
  source: AgentKnowledgeSource | null; // null = create, set = edit
  title: string;
  question: string;
  answer: string;
}

const EMPTY_EDITOR: EditorState = {
  open: false,
  source: null,
  title: "",
  question: "",
  answer: "",
};

export function FAQTab({ configId, sources, onChange, onRefresh }: Props) {
  const { createFAQ, updateFAQ, deleteKnowledgeSource, reindexKnowledgeSource } =
    useAgentActions();
  const [editor, setEditor] = React.useState<EditorState>(EMPTY_EDITOR);
  const [isPending, startTransition] = React.useTransition();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const faqs = sources.filter((s) => s.source_type === "faq");

  const openCreate = () => setEditor({ ...EMPTY_EDITOR, open: true });

  const openEdit = (source: AgentKnowledgeSource) => {
    const meta = source.metadata as FAQMetadata;
    setEditor({
      open: true,
      source,
      title: source.title,
      question: meta.question,
      answer: meta.answer,
    });
  };

  const handleSave = () => {
    const title = editor.title.trim();
    const question = editor.question.trim();
    const answer = editor.answer.trim();
    if (!title || !question || !answer) {
      toast.error("Preencha título, pergunta e resposta");
      return;
    }

    startTransition(async () => {
      try {
        if (editor.source) {
          const updated = await updateFAQ(editor.source.id, {
            title,
            question,
            answer,
          });
          onChange(sources.map((s) => (s.id === updated.id ? updated : s)));
          toast.success("FAQ atualizada");
        } else {
          const created = await createFAQ({
            config_id: configId,
            title,
            question,
            answer,
          });
          onChange([created, ...sources]);
          toast.success("FAQ criada — indexação em fila");
        }
        setEditor(EMPTY_EDITOR);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao salvar");
      }
    });
  };

  const handleDelete = (source: AgentKnowledgeSource) => {
    if (
      !window.confirm(
        `Apagar FAQ "${source.title}"? Essa ação remove o item e todos os chunks indexados.`,
      )
    ) {
      return;
    }
    setDeletingId(source.id);
    startTransition(async () => {
      try {
        await deleteKnowledgeSource(source.id);
        onChange(sources.filter((s) => s.id !== source.id));
        toast.success("FAQ removida");
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
            <HelpCircle className="size-5 text-primary" />
            <h2 className="font-semibold">Perguntas frequentes</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Perguntas e respostas que o agente consulta antes de responder. São
            indexadas via embedding e buscadas por similaridade.
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
          <Button onClick={openCreate} disabled={isPending}>
            <Plus className="size-4" />
            Nova FAQ
          </Button>
        </div>
      </div>

      {faqs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
              <HelpCircle className="size-6 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-1">
              <p className="font-semibold text-sm">Ensine o que o agente precisa saber</p>
              <p className="text-xs text-muted-foreground">
                Cadastre perguntas e respostas que o agente deve usar como base.
                Etapas com base de conhecimento ativa recuperam essas FAQs por similaridade
                antes de responder.
              </p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Adicionar FAQ
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {faqs.map((source) => {
            const meta = source.metadata as FAQMetadata;
            return (
              <Card key={source.id} className="transition-shadow hover:shadow-sm">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm truncate tracking-tight">
                          {source.title}
                        </p>
                        <IndexingStatusBadge
                          status={source.indexing_status}
                          error={source.indexing_error}
                          chunkCount={source.chunk_count}
                        />
                        {source.status === "archived" ? (
                          <Badge variant="outline" className="text-xs">
                            Arquivada
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>
                          <span className="font-medium text-foreground/80">
                            P:
                          </span>{" "}
                          <span className="line-clamp-2">{meta.question}</span>
                        </p>
                        <p>
                          <span className="font-medium text-foreground/80">
                            R:
                          </span>{" "}
                          <span className="line-clamp-2">{meta.answer}</span>
                        </p>
                      </div>
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
                        aria-label="Editar"
                        onClick={() => openEdit(source)}
                        disabled={isPending}
                      >
                        <Pencil className="size-4" />
                      </Button>
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
        open={editor.open}
        onOpenChange={(open) => {
          if (!open) setEditor(EMPTY_EDITOR);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editor.source ? "Editar FAQ" : "Nova FAQ"}
            </DialogTitle>
            <DialogDescription>
              O título ajuda você a organizar. A pergunta + resposta são o que o
              agente realmente consulta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="faq-title">Título</Label>
              <Input
                id="faq-title"
                value={editor.title}
                onChange={(e) =>
                  setEditor((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Ex: Política de cancelamento"
                disabled={isPending}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="faq-question">Pergunta</Label>
              <Textarea
                id="faq-question"
                value={editor.question}
                onChange={(e) =>
                  setEditor((prev) => ({ ...prev, question: e.target.value }))
                }
                placeholder="Como faço para cancelar minha assinatura?"
                rows={2}
                disabled={isPending}
                maxLength={FAQ_QUESTION_MAX_CHARS}
              />
              <p className="text-xs text-muted-foreground tabular-nums">
                {editor.question.length} / {FAQ_QUESTION_MAX_CHARS}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="faq-answer">Resposta</Label>
              <Textarea
                id="faq-answer"
                value={editor.answer}
                onChange={(e) =>
                  setEditor((prev) => ({ ...prev, answer: e.target.value }))
                }
                placeholder="Você pode cancelar a qualquer momento acessando..."
                rows={6}
                disabled={isPending}
                maxLength={FAQ_ANSWER_MAX_CHARS}
              />
              <p className="text-xs text-muted-foreground tabular-nums">
                {editor.answer.length} / {FAQ_ANSWER_MAX_CHARS}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditor(EMPTY_EDITOR)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

