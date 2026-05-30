"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Megaphone,
  RefreshCw,
  Save,
  Send,
  Users,
  Link2,
} from "lucide-react";
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
import { updateGroup, getInviteLink, sendInviteToLead, sendMessageToGroup } from "@/actions/groups";
import { createBrowserClient } from "@supabase/ssr";
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
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Supabase Realtime subscription for new group messages
  React.useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

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

  async function handleSendMessage() {
    const text = chatInput.trim();
    if (!text) return;
    setSendingMessage(true);
    setChatInput("");
    try {
      await sendMessageToGroup(group.id, text);
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem");
      setChatInput(text);
    } finally {
      setSendingMessage(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    msg.direction === "outbound"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background border"
                  }`}
                >
                  {msg.direction === "inbound" && msg.sender_name && (
                    <p className="text-xs font-semibold mb-1 text-primary">{msg.sender_name}</p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                  <p
                    className={`text-[10px] mt-1 text-right ${
                      msg.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {formatTime(msg.created_at)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div className="flex items-end gap-2 px-4 py-3 border-t">
            <Textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite uma mensagem... (Enter para enviar)"
              className="min-h-[40px] max-h-32 resize-none"
              rows={1}
              disabled={sendingMessage}
            />
            <Button
              size="icon"
              onClick={handleSendMessage}
              disabled={sendingMessage || !chatInput.trim()}
            >
              {sendingMessage ? (
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
