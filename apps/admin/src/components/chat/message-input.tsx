"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Paperclip, X, FileText, ImageIcon, Video, Mic, Sparkles, Copy } from "lucide-react";
import { generateAgentResponse, getActiveAssistants } from "@/actions/conversations";
import { uploadChatMedia } from "@/actions/messages";
import { toast } from "sonner";

const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // 16MB — WhatsApp limit

function getMediaType(mimeType: string): "image" | "audio" | "video" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

function getMediaIcon(type: string) {
  switch (type) {
    case "image": return ImageIcon;
    case "video": return Video;
    case "audio": return Mic;
    default: return FileText;
  }
}

interface Props {
  conversationId: string;
  onSend: (content: string) => void;
  onSendMedia: (file: { mediaUrl: string; type: "image" | "audio" | "video" | "document"; fileName: string; caption?: string }) => void;
  sending?: boolean;
}

export function MessageInput({ conversationId, onSend, onSendMedia, sending }: Props) {
  const [text, setText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI Assistant state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAssistants, setAiAssistants] = useState<Array<{ id: string; name: string; category: string }>>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState("");
  const [assistantsLoaded, setAssistantsLoaded] = useState(false);
  const aiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [text]);

  // Close AI popover on outside click
  useEffect(() => {
    if (!aiOpen) return;
    function handleClick(e: MouseEvent) {
      if (aiRef.current && !aiRef.current.contains(e.target as Node)) setAiOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [aiOpen]);

  // Load assistants when AI popover opens
  useEffect(() => {
    if (aiOpen && !assistantsLoaded) {
      getActiveAssistants().then((list) => {
        setAiAssistants(list.map((a) => ({ id: a.id, name: a.name, category: a.category || "geral" })));
        if (list.length > 0 && !selectedAssistantId) setSelectedAssistantId(list[0].id);
        setAssistantsLoaded(true);
      }).catch(() => {});
    }
  }, [aiOpen, assistantsLoaded, selectedAssistantId]);

  async function handleAiGenerate() {
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
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    if (file.size > MAX_MEDIA_BYTES) {
      toast.error(`Arquivo muito grande. Maximo: 16MB (atual: ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      return;
    }

    setSelectedFile(file);

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => setFilePreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  }

  function clearFile() {
    setSelectedFile(null);
    setFilePreview(null);
  }

  async function handleSubmit() {
    if (sending || uploading) return;

    if (selectedFile) {
      setUploading(true);
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
          reader.readAsDataURL(selectedFile);
        });

        const { url, error } = await uploadChatMedia(conversationId, base64, selectedFile.name);
        if (error || !url) {
          toast.error(error || "Falha ao enviar arquivo");
          return;
        }

        onSendMedia({
          mediaUrl: url,
          type: getMediaType(selectedFile.type),
          fileName: selectedFile.name,
          caption: text.trim() || undefined,
        });
        setText("");
        clearFile();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao processar arquivo");
      } finally {
        setUploading(false);
      }
      return;
    }

    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const mediaType = selectedFile ? getMediaType(selectedFile.type) : null;
  const MediaIcon = mediaType ? getMediaIcon(mediaType) : FileText;

  return (
    <div className="px-4 py-3 border-t border-border bg-card">
      {/* File preview */}
      {selectedFile && (
        <div className="mb-2 flex items-center gap-3 bg-muted border border-border rounded-xl p-2.5">
          {filePreview ? (
            <img src={filePreview} alt="Preview" className="size-12 rounded-lg object-cover" />
          ) : (
            <div className="size-12 rounded-lg bg-background flex items-center justify-center">
              <MediaIcon className="size-5 text-muted-foreground/60" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{selectedFile.name}</p>
            <p className="text-[10px] text-muted-foreground/60">{(selectedFile.size / 1024).toFixed(0)} KB</p>
          </div>
          <button onClick={clearFile} aria-label="Remover arquivo" className="text-muted-foreground/60 hover:text-foreground shrink-0 p-1">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* AI Suggestion popover */}
      {aiOpen && (
        <div ref={aiRef} className="mb-2 bg-card border border-border rounded-xl p-3 shadow-lg space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Assistente IA - Apoio ao agente</p>

          {aiAssistants.length > 1 && (
            <select
              value={selectedAssistantId}
              onChange={(e) => setSelectedAssistantId(e.target.value)}
              className="w-full h-8 rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
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
            <p className="text-xs text-muted-foreground">Nenhum assistente ativo. Configure em Automacoes.</p>
          )}

          <textarea
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            placeholder="Ex: Como responder sobre o preco?"
            rows={2}
            className="w-full rounded-md border border-border bg-muted px-2.5 py-2 text-sm text-foreground outline-none resize-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAiGenerate();
              }
            }}
          />
          <button
            onClick={handleAiGenerate}
            disabled={aiLoading || !aiQuery.trim() || aiAssistants.length === 0}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {aiLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {aiLoading ? "Gerando..." : "Gerar sugestao"}
          </button>
          {aiSuggestion && (
            <div className="space-y-2">
              <div className="rounded-lg bg-muted p-3 text-sm text-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
                {aiSuggestion}
              </div>
              <button
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-border text-sm rounded-lg hover:bg-muted transition-colors text-foreground"
                onClick={() => {
                  navigator.clipboard.writeText(aiSuggestion);
                  toast.success("Sugestao copiada!");
                }}
              >
                <Copy className="size-3.5" />
                Copiar sugestao
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          onChange={handleFileSelect}
        />

        {/* AI button */}
        <button
          onClick={() => setAiOpen(!aiOpen)}
          className={`size-10 flex items-center justify-center rounded-xl transition-colors shrink-0 ${
            aiOpen ? "bg-primary text-white" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted"
          }`}
          title="Gerar resposta com IA"
          aria-label="Gerar resposta com IA"
        >
          <Sparkles className="size-5" />
        </button>

        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="size-10 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded-xl transition-colors shrink-0 disabled:opacity-50"
          title="Anexar arquivo"
          aria-label="Anexar arquivo"
        >
          <Paperclip className="size-5" />
        </button>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedFile ? "Legenda (opcional)..." : "Digite uma mensagem..."}
          rows={1}
          className="flex-1 resize-none bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary max-h-[120px]"
        />

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={(!text.trim() && !selectedFile) || sending || uploading}
          aria-label={uploading ? "Enviando arquivo" : "Enviar"}
          className="size-10 bg-primary hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl flex items-center justify-center text-white transition-colors shrink-0"
        >
          {sending || uploading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>
    </div>
  );
}
