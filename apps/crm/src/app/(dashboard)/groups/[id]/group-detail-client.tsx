"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  FileText,
  ImageIcon,
  Loader2,
  Megaphone,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  RefreshCw,
  Reply,
  Save,
  Send,
  UserPlus,
  Users,
  Link2,
  X,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@persia/ui/avatar";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Switch } from "@persia/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@persia/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@persia/ui/dropdown-menu";
import {
  updateGroup,
  getInviteLink,
  sendInviteToLead,
  sendMessageToGroup,
  sendMediaToGroup,
  createLeadFromGroupParticipant,
} from "@/actions/groups";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface Group {
  id: string;
  group_jid: string;
  name: string;
  description: string | null;
  invite_link: string | null;
  participant_count: number;
  is_announce: boolean;
  category: string;
}

interface Lead {
  id: string;
  name: string;
  phone: string | null;
}

interface GroupMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  sender_name: string | null;
  sender_jid: string | null;
  sender_phone: string | null;
  sender_lead_id: string | null;
  sender_membership_id: string | null;
  sender_identity_kind: "phone" | "lid" | "unknown" | null;
  sender_avatar_url: string | null;
  media_type: string | null;
  media_url: string | null;
  whatsapp_msg_id: string | null;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  geral: "Geral",
  aquecimento: "Aquecimento",
  evento: "Evento",
  oferta: "Oferta",
  alunos: "Alunos",
};

export function GroupDetailClient({
  group,
  leads,
  initialMessages,
}: {
  group: Group;
  leads: Lead[];
  initialMessages: GroupMessage[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState(group.name);
  const [description, setDescription] = React.useState(group.description || "");
  const [isAnnounce, setIsAnnounce] = React.useState(group.is_announce);
  const [category, setCategory] = React.useState(group.category);
  const [inviteLink, setInviteLink] = React.useState(group.invite_link || "");
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // Send invite dialog
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [selectedLeadId, setSelectedLeadId] = React.useState("");
  const [sendingInvite, setSendingInvite] = React.useState(false);

  // Chat state
  const [messages, setMessages] = React.useState<GroupMessage[]>(initialMessages);
  const [chatInput, setChatInput] = React.useState("");
  const [sendingMessage, setSendingMessage] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<GroupMessage | null>(null);
  const [creatingLeadFor, setCreatingLeadFor] = React.useState<string | null>(null);
  const [attachedFile, setAttachedFile] = React.useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = React.useState<string | null>(null);
  const [attachedMediaType, setAttachedMediaType] = React.useState<"image" | "video" | "audio" | "document">("document");
  const [sendingMedia, setSendingMedia] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Scroll to bottom on new messages
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Supabase Realtime subscription for new group messages
  React.useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`group_messages:${group.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${group.id}`,
        },
        (payload) => {
          const row = payload.new as GroupMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [group.id]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await updateGroup(group.id, {
        name: name.trim(),
        description: description.trim(),
        is_announce: isAnnounce,
        category,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleGetInviteLink() {
    try {
      const link = await getInviteLink(group.id);
      setInviteLink(link);
      toast.success("Link obtido");
    } catch (err: any) {
      toast.error(err.message || "Erro ao obter link");
    }
  }

  function copyLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    toast.success("Link copiado!");
  }

  async function handleSendInvite() {
    if (!selectedLeadId) return;
    setSendingInvite(true);
    try {
      await sendInviteToLead(group.id, selectedLeadId);
      toast.success("Convite enviado!");
      setInviteOpen(false);
      setSelectedLeadId("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar convite");
    } finally {
      setSendingInvite(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    let mt: "image" | "video" | "audio" | "document" = "document";
    if (file.type.startsWith("image/")) mt = "image";
    else if (file.type.startsWith("video/")) mt = "video";
    else if (file.type.startsWith("audio/")) mt = "audio";
    setAttachedMediaType(mt);
    setAttachedFile(file);
    if (mt === "image") {
      const reader = new FileReader();
      reader.onload = (ev) => setAttachedPreview(ev.target?.result as string ?? null);
      reader.readAsDataURL(file);
    } else {
      setAttachedPreview(null);
    }
  }

  function clearAttachment() {
    setAttachedFile(null);
    setAttachedPreview(null);
  }

  async function handleSendMessage() {
    // If there's a file attachment, send as media
    if (attachedFile) {
      const caption = chatInput.trim() || undefined;
      const file = attachedFile;
      const mt = attachedMediaType;
      clearAttachment();
      setChatInput("");
      setSendingMedia(true);
      try {
        const reader = new FileReader();
        await new Promise<void>((resolve, reject) => {
          reader.onload = async (ev) => {
            const base64 = ev.target?.result as string;
            if (!base64) { reject(new Error("Falha ao ler arquivo")); return; }
            try {
              await sendMediaToGroup(group.id, base64, mt, caption, file.name);
              resolve();
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
          reader.readAsDataURL(file);
        });
        toast.success("Mídia enviada");
      } catch (err: any) {
        toast.error(err.message || "Erro ao enviar mídia");
      } finally {
        setSendingMedia(false);
      }
      return;
    }

    const text = chatInput.trim();
    if (!text) return;
    setSendingMessage(true);
    const currentReply = replyTo;
    setChatInput("");
    setReplyTo(null);
    try {
      await sendMessageToGroup(group.id, text, currentReply?.whatsapp_msg_id ?? null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem");
      setChatInput(text);
      setReplyTo(currentReply);
    } finally {
      setSendingMessage(false);
    }
  }

  async function handleCreateLead(msg: GroupMessage) {
    if (!msg.sender_phone || msg.sender_lead_id) return;
    setCreatingLeadFor(msg.id);
    try {
      const { leadId } = await createLeadFromGroupParticipant({
        groupId: group.id,
        membershipId: msg.sender_membership_id,
        phone: msg.sender_phone,
        name: msg.sender_name || undefined,
      });
      // Atualiza mensagens localmente com o novo lead_id
      setMessages((prev) =>
        prev.map((m) =>
          m.sender_phone === msg.sender_phone
            ? { ...m, sender_lead_id: leadId }
            : m
        )
      );
      toast.success("Lead criado!", {
        action: { label: "Ver perfil", onClick: () => router.push(`/leads/${leadId}`) },
      });
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar lead");
    } finally {
      setCreatingLeadFor(null);
    }
  }

  function handleReply(msg: GroupMessage) {
    setReplyTo(msg);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      setReplyTo(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/groups">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary" className="text-xs">
              <Users className="size-3 mr-1" />
              {group.participant_count} membros
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {CATEGORY_LABELS[group.category] || group.category}
            </Badge>
            {group.is_announce && (
              <Badge variant="outline" className="text-xs">
                <Megaphone className="size-3 mr-1" />
                Modo anuncio
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Chat */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="size-4" />
            Chat do Grupo
          </CardTitle>
          <CardDescription>Mensagens enviadas e recebidas no grupo</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {/* Message list */}
          <div className="h-72 overflow-y-auto px-4 py-3 space-y-2 bg-muted/30">
            {messages.length === 0 && (
              <p className="text-center text-xs text-muted-foreground pt-8">
                Nenhuma mensagem ainda. Envie a primeira!
              </p>
            )}
            {messages.map((msg, idx) => {
              const isInbound = msg.direction === "inbound";
              const nextMsg = messages[idx + 1];
              const isLastInBlock = isInbound && (
                !nextMsg ||
                nextMsg.direction !== "inbound" ||
                (nextMsg.sender_jid ?? nextMsg.sender_name) !== (msg.sender_jid ?? msg.sender_name)
              );
              const senderLabel = msg.sender_name || msg.sender_phone || "?";
              const initials = senderLabel
                .split(" ")
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
              const isCreatingLead = creatingLeadFor === msg.id;
              return (
                <div
                  key={msg.id}
                  className={`group/msg flex items-end gap-1.5 ${isInbound ? "justify-start" : "justify-end"}`}
                >
                  {/* Avatar (inbound only — último do bloco) */}
                  {isInbound && (
                    <div className="w-6 shrink-0 self-end mb-0.5">
                      {isLastInBlock ? (
                        <Avatar size="sm">
                          {msg.sender_avatar_url ? (
                            <AvatarImage src={msg.sender_avatar_url} alt={senderLabel} />
                          ) : null}
                          <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
                        </Avatar>
                      ) : null}
                    </div>
                  )}

                  {/* Bubble */}
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      isInbound
                        ? "bg-background border"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {isInbound && (
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        {msg.sender_name && (
                          <span className="text-xs font-semibold text-primary leading-none">
                            {msg.sender_name}
                          </span>
                        )}
                        {msg.sender_phone && (
                          <span className="text-[10px] text-muted-foreground leading-none">
                            {msg.sender_phone}
                          </span>
                        )}
                        {msg.sender_lead_id && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 leading-none">
                            lead
                          </Badge>
                        )}
                        {msg.sender_identity_kind === "lid" && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 leading-none text-muted-foreground">
                            sem tel.
                          </Badge>
                        )}
                      </div>
                    )}
                    {msg.media_type && msg.media_url && (
                      <p className="text-[11px] text-muted-foreground mb-1 italic">
                        [{msg.media_type}]
                      </p>
                    )}
                    {msg.text && (
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    )}
                    <p
                      className={`text-[10px] mt-1 text-right ${
                        isInbound ? "text-muted-foreground" : "text-primary-foreground/70"
                      }`}
                    >
                      {formatTime(msg.created_at)}
                    </p>
                  </div>

                  {/* Action menu (visible on hover) */}
                  <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity self-center shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="size-6" />}>
                        <MoreVertical className="size-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align={isInbound ? "start" : "end"} className="w-44">
                        <DropdownMenuItem onClick={() => handleReply(msg)}>
                          <Reply className="size-3.5 mr-2" />
                          Responder
                        </DropdownMenuItem>
                        {msg.text && (
                          <DropdownMenuItem
                            onClick={() => {
                              navigator.clipboard.writeText(msg.text!);
                              toast.success("Copiado!");
                            }}
                          >
                            <Copy className="size-3.5 mr-2" />
                            Copiar texto
                          </DropdownMenuItem>
                        )}
                        {isInbound && (msg.sender_lead_id || msg.sender_phone) && (
                          <DropdownMenuSeparator />
                        )}
                        {isInbound && msg.sender_lead_id && (
                          <>
                            <DropdownMenuItem onClick={() => router.push(`/leads/${msg.sender_lead_id!}`)}>
                              <ExternalLink className="size-3.5 mr-2" />
                              Ver perfil
                            </DropdownMenuItem>
                            {msg.sender_phone && (
                              <DropdownMenuItem onClick={() => router.push(`/chat?lead=${msg.sender_lead_id!}`)}>
                                <MessageCircle className="size-3.5 mr-2" />
                                Abrir chat 1:1
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                        {isInbound && !msg.sender_lead_id && msg.sender_phone && (
                          <DropdownMenuItem
                            onClick={() => handleCreateLead(msg)}
                            disabled={isCreatingLead}
                          >
                            {isCreatingLead ? (
                              <Loader2 className="size-3.5 mr-2 animate-spin" />
                            ) : (
                              <UserPlus className="size-3.5 mr-2" />
                            )}
                            Criar lead
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply context bar */}
          {replyTo && (
            <div className="flex items-center gap-2 px-4 py-2 border-t bg-muted/40 text-xs">
              <Reply className="size-3 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground truncate flex-1">
                Respondendo{replyTo.sender_name ? ` a ${replyTo.sender_name}` : ""}: {replyTo.text?.slice(0, 60) ?? "[mídia]"}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-5 shrink-0"
                onClick={() => setReplyTo(null)}
              >
                <X className="size-3" />
              </Button>
            </div>
          )}

          {/* Media preview bar */}
          {attachedFile && (
            <div className="flex items-center gap-3 px-4 py-2 border-t bg-muted/40">
              {attachedPreview ? (
                <img
                  src={attachedPreview}
                  alt="preview"
                  className="h-14 w-14 rounded object-cover border shrink-0"
                />
              ) : (
                <div className="h-14 w-14 rounded border bg-background flex items-center justify-center shrink-0">
                  {attachedMediaType === "video" ? (
                    <ImageIcon className="size-5 text-muted-foreground" />
                  ) : attachedMediaType === "audio" ? (
                    <Mic className="size-5 text-muted-foreground" />
                  ) : (
                    <FileText className="size-5 text-muted-foreground" />
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{attachedFile.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {attachedMediaType} · {(attachedFile.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 shrink-0"
                onClick={clearAttachment}
              >
                <X className="size-3" />
              </Button>
            </div>
          )}

          {/* Input bar */}
          <div className="flex items-end gap-2 px-4 py-3 border-t">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 mb-0.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendingMessage || sendingMedia}
              title="Anexar arquivo"
            >
              <Paperclip className="size-4" />
            </Button>
            <Textarea
              ref={inputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={attachedFile ? "Legenda (opcional)..." : "Digite uma mensagem... (Enter para enviar)"}
              className="min-h-[40px] max-h-32 resize-none"
              rows={1}
              disabled={sendingMessage || sendingMedia}
            />
            <Button
              size="icon"
              onClick={handleSendMessage}
              disabled={(sendingMessage || sendingMedia) || (!attachedFile && !chatInput.trim())}
            >
              {(sendingMessage || sendingMedia) ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Invite Link Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="size-5" />
            Link de Convite
          </CardTitle>
          <CardDescription>
            Envie este link para leads entrarem no grupo de forma segura
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={inviteLink}
              readOnly
              placeholder="Clique em obter link..."
              className="font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={copyLink} disabled={!inviteLink}>
              <Copy className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleGetInviteLink}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Send className="size-4" />
              Enviar convite para lead
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Configurações</CardTitle>
          <CardDescription>
            Altere nome, descrição e modo do grupo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-16"
              placeholder="Descrição do grupo..."
            />
          </div>
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={(v) => setCategory(v ?? "geral")}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="geral">Geral</SelectItem>
                <SelectItem value="aquecimento">Aquecimento</SelectItem>
                <SelectItem value="evento">Evento</SelectItem>
                <SelectItem value="oferta">Oferta</SelectItem>
                <SelectItem value="alunos">Alunos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Modo Anuncio</p>
              <p className="text-xs text-muted-foreground">
                Apenas administradores podem enviar mensagens
              </p>
            </div>
            <Switch checked={isAnnounce} onCheckedChange={setIsAnnounce} />
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Salvando..." : "Salvar"}
        </Button>
        {saved && <span className="text-sm text-success">Salvo!</span>}
      </div>

      {/* Send Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar Convite</DialogTitle>
            <DialogDescription>
              O lead recebera uma mensagem no WhatsApp com o link de convite do grupo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Selecione o Lead</Label>
            <Select value={selectedLeadId} onValueChange={(v) => setSelectedLeadId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Buscar lead..." />
              </SelectTrigger>
              <SelectContent>
                {leads.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.name} {lead.phone ? `(${lead.phone})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleSendInvite} disabled={sendingInvite || !selectedLeadId}>
              {sendingInvite ? "Enviando..." : "Enviar Convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
