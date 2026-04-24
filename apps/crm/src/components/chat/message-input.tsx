"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { sendMessageViaWhatsApp, sendMediaViaWhatsApp, type Message } from "@/actions/messages";
import { generateAgentResponse } from "@/actions/conversations";
import { getAssistants } from "@/actions/ai";
import { Button } from "@persia/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@persia/ui/popover";
import {
  Send,
  Paperclip,
  X,
  FileText,
  Loader2,
  Sparkles,
  Smile,
  Copy,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { useConversationWindow } from "@/lib/hooks/use-conversation-window";
import { TemplateSelector } from "@/components/chat/template-selector";

// Lazy-load ~150KB picker only when the popover opens
const EmojiPicker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => <div className="p-4 text-xs text-muted-foreground">Carregando emojis...</div>,
});


type MessageInputProps = {
  conversationId: string;
  onMessageSent: (message: Message) => void;
  disabled?: boolean;
};

function getMediaType(mimeType: string): "image" | "audio" | "video" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

export function MessageInput({
  conversationId,
  onMessageSent,
  disabled = false,
}: MessageInputProps) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAssistants, setAiAssistants] = useState<Array<{ id: string; name: string; category: string }>>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState("");
  const [assistantsLoaded, setAssistantsLoaded] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const {
    isMeta,
    inWindow,
    hoursLeft,
    refresh: refreshWindow,
  } = useConversationWindow(conversationId);
  const showTemplates = isMeta;              // conn Meta = templates disponiveis
  const composerLocked = isMeta && !inWindow; // fora da janela: so template pode ser enviado

  // Load assistants when AI popover opens
  useEffect(() => {
    if (aiOpen && !assistantsLoaded) {
      getAssistants().then((list) => {
        const active = list.filter((a: any) => a.is_active);
        setAiAssistants(active.map((a: any) => ({ id: a.id, name: a.name, category: a.category || "geral" })));
        if (active.length > 0 && !selectedAssistantId) {
          setSelectedAssistantId(active[0].id);
        }
        setAssistantsLoaded(true);
      }).catch(() => {});
    }
  }, [aiOpen, assistantsLoaded, selectedAssistantId]);

  const handleAiGenerate = async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiSuggestion("");
    try {
      const result = await generateAgentResponse(conversationId, aiQuery.trim(), selectedAssistantId || undefined);
      if (result.error) {
        toast.error(result.error);
      } else {
        setAiSuggestion(result.suggestion);
      }
    } catch {
      toast.error("Erro ao gerar sugestao");
    } finally {
      setAiLoading(false);
    }
  };

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);

    // Generate preview for images
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => setFilePreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }

    // Reset file input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const clearFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
  };

  const handleSend = async () => {
    if (sending || disabled) return;

    // Send media if file is selected
    if (selectedFile) {
      setSending(true);

      try {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(selectedFile);
        });
        const base64 = await base64Promise;

        const mediaType = getMediaType(selectedFile.type);
        const { data, error } = await sendMediaViaWhatsApp(conversationId, {
          base64,
          type: mediaType,
          fileName: selectedFile.name,
          caption: content.trim() || undefined,
        });

        if (data) {
          onMessageSent(data);
          setContent("");
          clearFile();
          if (textareaRef.current) textareaRef.current.style.height = "auto";
        }
        if (error) toast.error(`Falha ao enviar: ${error}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao processar arquivo");
      }

      setSending(false);
      textareaRef.current?.focus();
      return;
    }

    // Send text message
    const trimmed = content.trim();
    if (!trimmed) return;

    setSending(true);
    const { data, error } = await sendMessageViaWhatsApp(
      conversationId,
      trimmed
    );

    if (data) {
      onMessageSent(data);
      setContent("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }

    if (error) {
      toast.error(`Falha ao enviar: ${error}`);
    }

    setSending(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t bg-card p-3 md:px-8 lg:px-16">
      {/* 24h window banner (Meta Cloud apenas) */}
      {composerLocked && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <Clock className="size-5 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">Fora da janela de 24h</p>
            <p className="text-xs text-amber-300/80 mt-0.5">
              A Meta so permite texto livre ate 24h depois da ultima mensagem do lead.
              Use um template aprovado para reabrir a conversa.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setTemplateOpen(true)}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            <FileText className="size-4" />
            Enviar template
          </Button>
        </div>
      )}

      {/* Meta Cloud dentro da janela: aviso sutil quando faltar pouco */}
      {isMeta && inWindow && hoursLeft <= 4 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-amber-400/90">
          <Clock className="size-3" />
          Janela de 24h expira em {Math.round(hoursLeft)}h — envie um template antes para nao perder o contato.
        </div>
      )}

      {/* File preview */}
      {selectedFile && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted/50 p-2">
          {filePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={filePreview}
              alt="Preview"
              className="size-12 rounded-md object-cover"
            />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-md bg-muted">
              <FileText className="size-5 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{selectedFile.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {(selectedFile.size / 1024).toFixed(0)} KB
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={clearFile}
            className="shrink-0"
            aria-label="Remover arquivo"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      <div
        className={cn(
          "flex items-center gap-2",
          disabled && "opacity-50"
        )}
      >
        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          onChange={handleFileSelect}
        />
        <input
          ref={imageInputRef}
          type="file"
          className="hidden"
          accept="image/*"
          onChange={handleFileSelect}
        />

        {/* AI Generate */}
        <Popover open={aiOpen} onOpenChange={setAiOpen}>
          <PopoverTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              className="shrink-0 size-8 rounded-lg"
              title="Gerar resposta com IA"
              aria-label="Gerar resposta com IA"
            >
              <Sparkles className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-80 p-3">
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Assistente IA - Apoio ao agente</p>

              {/* Assistant selector */}
              {aiAssistants.length > 1 && (
                <select
                  value={selectedAssistantId}
                  onChange={(e) => setSelectedAssistantId(e.target.value)}
                  className="w-full h-8 rounded-md border bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                >
                  {aiAssistants.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
              {aiAssistants.length === 1 && (
                <p className="text-xs text-primary font-medium">{aiAssistants[0].name}</p>
              )}
              {aiAssistants.length === 0 && assistantsLoaded && (
                <p className="text-xs text-muted-foreground">Nenhum assistente ativo. Crie em Automações.</p>
              )}

              <textarea
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                placeholder="Ex: Como responder sobre o preco?"
                rows={2}
                className="w-full rounded-md border bg-transparent px-2.5 py-2 text-sm outline-none resize-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAiGenerate();
                  }
                }}
              />
              <Button size="sm" onClick={handleAiGenerate} disabled={aiLoading || !aiQuery.trim() || aiAssistants.length === 0} className="w-full">
                {aiLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {aiLoading ? "Gerando..." : "Gerar sugestao"}
              </Button>
              {aiSuggestion && (
                <div className="space-y-2">
                  <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {aiSuggestion}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      navigator.clipboard.writeText(aiSuggestion);
                      toast.success("Sugestao copiada!");
                    }}
                  >
                    <Copy className="size-3.5" />
                    Copiar sugestao
                  </Button>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Attach file */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || sending}
          className="shrink-0 size-8 rounded-lg"
          title="Anexar arquivo"
          aria-label="Anexar arquivo"
        >
          <Paperclip className="size-4" />
        </Button>

        {/* Template (Meta Cloud) */}
        {showTemplates && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setTemplateOpen(true)}
            disabled={disabled || sending}
            className="shrink-0 size-8 rounded-lg"
            title="Enviar template oficial"
            aria-label="Enviar template oficial"
          >
            <FileText className="size-4" />
          </Button>
        )}

        {/* Emoji Picker */}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              className="shrink-0 size-8 rounded-lg"
              title="Emoji"
              aria-label="Emoji"
            >
              <Smile className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-auto p-0 border-0">
            <EmojiPicker
              onEmojiClick={(emojiData) => {
                setContent((prev) => prev + emojiData.emoji);
                setEmojiOpen(false);
                textareaRef.current?.focus();
              }}
              width={320}
              height={400}
              searchPlaceholder="Buscar emoji..."
              previewConfig={{ showPreview: false }}
            />
          </PopoverContent>
        </Popover>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            adjustTextareaHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? "Conversa encerrada"
              : composerLocked
                ? "Fora da janela de 24h — use um template"
                : selectedFile
                  ? "Adicione uma legenda (opcional)..."
                  : "Digite uma mensagem..."
          }
          disabled={disabled || composerLocked}
          rows={1}
          className="max-h-24 min-h-[36px] flex-1 resize-none rounded-xl border bg-muted/50 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:ring-offset-2"
        />

        {/* Send button */}
        <Button
          type="button"
          variant="default"
          size="icon-sm"
          onClick={handleSend}
          disabled={(!content.trim() && !selectedFile) || sending || disabled || composerLocked}
          title={composerLocked ? "Fora da janela de 24h — use um template" : "Enviar"}
          aria-label="Enviar mensagem"
          className="shrink-0 rounded-full"
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>

      <TemplateSelector
        open={templateOpen}
        conversationId={conversationId}
        onClose={() => setTemplateOpen(false)}
        onSent={() => {
          refreshWindow();
          onMessageSent({
            // placeholder para UI atualizar imediatamente — o realtime traz a mensagem real
            id: `tpl-${Date.now()}`,
            conversation_id: conversationId,
            sender: "agent",
            type: "template",
            content: "[Template enviado]",
            created_at: new Date().toISOString(),
          } as unknown as Message);
        }}
      />
    </div>
  );
}
