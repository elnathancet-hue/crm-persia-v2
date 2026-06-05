"use client";

import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@persia/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@persia/ui/tooltip";
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
  Mic,
  Square,
  CornerUpLeft,
  Plus,
  ImageIcon,
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


type ReplyTo = {
  id: string;
  whatsapp_msg_id: string | null;
  content: string | null;
  sender: string;
};

type MessageInputProps = {
  conversationId: string;
  onMessageSent: (message: Message) => void;
  disabled?: boolean;
  replyTo?: ReplyTo | null;
  onClearReply?: () => void;
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
  replyTo,
  onClearReply,
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
  // Audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          setSending(true);
          try {
            const { data, error } = await sendMediaViaWhatsApp(conversationId, {
              base64,
              type: "ptt",
              fileName: "audio.webm",
              replyToWhatsAppMsgId: replyTo?.whatsapp_msg_id ?? undefined,
            });
            if (data) {
              onMessageSent(data);
              onClearReply?.();
            }
            if (error) toast.error(`Falha ao enviar áudio: ${error}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao enviar áudio");
          } finally {
            setSending(false);
          }
        };
        reader.readAsDataURL(blob);

        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingSeconds(0);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone");
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleCancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      // Suppress onstop handler by swapping it out
      mediaRecorderRef.current.onstop = () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingSeconds(0);
      };
      mediaRecorderRef.current.stop();
    }
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
          replyToWhatsAppMsgId: replyTo?.whatsapp_msg_id ?? undefined,
        });

        if (data) {
          onMessageSent(data);
          setContent("");
          clearFile();
          onClearReply?.();
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
      trimmed,
      { replyToWhatsAppMsgId: replyTo?.whatsapp_msg_id ?? undefined }
    );

    if (data) {
      onMessageSent(data);
      setContent("");
      onClearReply?.();
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
    /* PR 39 (mai/2026): TooltipProvider envolve o input inteiro pra
       que cada ícone de ação (Sparkles, Paperclip, Template, Emoji)
       tenha tooltip do design system em vez do title HTML nativo
       (que era discreto demais e não aparecia consistente entre
       browsers). delay 300ms pra não disparar em hover acidental. */
    <TooltipProvider delay={300}>
    <div
      className="border-t border-[color:var(--chat-sidebar-divider)] px-3 py-2"
      style={{ background: "var(--chat-input-bar-bg)" }}
    >
      {/* 24h window banner (Meta Cloud apenas) */}
      {composerLocked && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-warning-ring bg-warning-soft p-3">
          <Clock className="size-5 text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-warning-soft-foreground">Fora da janela de 24h</p>
            <p className="text-xs text-warning-soft-foreground/80 mt-0.5">
              A Meta só permite texto livre até 24h depois da última mensagem do lead.
              Use um template aprovado para reabrir a conversa.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setTemplateOpen(true)}
            className="shrink-0 bg-success text-success-foreground hover:bg-success/90"
          >
            <FileText className="size-4" />
            Enviar template
          </Button>
        </div>
      )}

      {/* Meta Cloud dentro da janela: aviso sutil quando faltar pouco */}
      {isMeta && inWindow && hoursLeft <= 4 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-warning">
          <Clock className="size-3" />
          Janela de 24h expira em {Math.round(hoursLeft)}h — envie um template antes para nao perder o contato.
        </div>
      )}

      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-4 border-[color:var(--chat-send-bg)] bg-muted/50 px-3 py-2">
          <CornerUpLeft className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-[color:var(--chat-send-bg)] truncate">{replyTo.sender}</p>
            <p className="text-xs text-muted-foreground truncate">{replyTo.content || "Mídia"}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClearReply}
            className="shrink-0"
            aria-label="Cancelar resposta"
          >
            <X className="size-3.5" />
          </Button>
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

      {/* AI Generate Panel — inline, expande acima dos botões */}
      {aiOpen && (
        <div className="mb-2 rounded-xl border bg-popover p-3 shadow-lg">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Assistente IA — Apoio ao agente</p>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setAiOpen(false)} className="size-6">
                <X className="size-3" />
              </Button>
            </div>
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
              placeholder="Ex: Como responder sobre o preço?"
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
              {aiLoading ? "Gerando..." : "Gerar sugestão"}
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
                    toast.success("Sugestão copiada!");
                  }}
                >
                  <Copy className="size-3.5" />
                  Copiar sugestão
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "flex items-end gap-2",
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

        {/* + menu — Fotos/Docs/IA/Template (estilo WhatsApp) */}
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || sending}
              className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-transparent hover:text-[color:var(--chat-header-fg)]"
              aria-label="Mais opções"
            >
              <Plus className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
              <ImageIcon className="size-4 text-progress" />
              Fotos e vídeos
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="size-4 text-muted-foreground" />
              Documento
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setAiOpen(true)}>
              <Sparkles className="size-4 text-primary" />
              Gerar com IA
            </DropdownMenuItem>
            {showTemplates && (
              <DropdownMenuItem onClick={() => setTemplateOpen(true)}>
                <FileText className="size-4 text-warning" />
                Template oficial
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Emoji Picker */}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-transparent hover:text-[color:var(--chat-header-fg)]"
                    aria-label="Emoji"
                  >
                    <Smile className="size-4" />
                  </Button>
                </PopoverTrigger>
              }
            />
            <TooltipContent>Inserir emoji</TooltipContent>
          </Tooltip>
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
          className="max-h-28 min-h-[42px] flex-1 resize-none rounded-lg border-0 px-4 py-[11px] text-[15px] leading-5 outline-none placeholder:text-[color:var(--chat-timestamp)] focus:ring-1 focus:ring-[color:var(--chat-send-bg)]"
          style={{
            background: "var(--chat-input-field-bg)",
            color: "var(--chat-header-fg)",
          }}
        />

        {/* Recording indicator or Send/Mic button */}
        {isRecording ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium tabular-nums text-destructive">
              {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:{String(recordingSeconds % 60).padStart(2, "0")}
            </span>
            {/* Cancel */}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleCancelRecording}
              className="size-10 shrink-0 rounded-full text-muted-foreground"
              aria-label="Cancelar gravação"
            >
              <X className="size-4" />
            </Button>
            {/* Send recording */}
            <Button
              type="button"
              variant="default"
              size="icon-sm"
              onClick={handleStopRecording}
              aria-label="Enviar áudio"
              className="size-10 shrink-0 rounded-full hover:opacity-90"
              style={{ backgroundColor: "var(--chat-send-bg)", color: "var(--chat-send-fg)" }}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        ) : content.trim() || selectedFile ? (
          <Button
            type="button"
            variant="default"
            size="icon-sm"
            onClick={handleSend}
            disabled={sending || disabled || composerLocked}
            title={composerLocked ? "Fora da janela de 24h — use um template" : "Enviar"}
            aria-label="Enviar mensagem"
            className="size-10 shrink-0 rounded-full hover:opacity-90 disabled:opacity-70"
            style={{ backgroundColor: "var(--chat-send-bg)", color: "var(--chat-send-fg)" }}
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            size="icon-sm"
            onClick={handleStartRecording}
            disabled={disabled || composerLocked || sending}
            aria-label="Gravar áudio"
            className="size-10 shrink-0 rounded-full hover:opacity-90 disabled:opacity-70"
            style={{ backgroundColor: "var(--chat-send-bg)", color: "var(--chat-send-fg)" }}
          >
            <Mic className="size-4" />
          </Button>
        )}
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
    </TooltipProvider>
  );
}
