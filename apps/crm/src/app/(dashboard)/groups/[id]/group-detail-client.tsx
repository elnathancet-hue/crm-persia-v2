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

const CATEGORY_LABELS: Record<string, string> = {
  geral: "Geral",
  aquecimento: "Aquecimento",
  evento: "Evento",
  oferta: "Oferta",
  alunos: "Alunos",
};

export function GroupDetailClient({ group, leads }: { group: Group; leads: Lead[] }) {
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

  // Send message dialog
  const [messageOpen, setMessageOpen] = React.useState(false);
  const [groupMessage, setGroupMessage] = React.useState("");
  const [sendingMessage, setSendingMessage] = React.useState(false);

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
    if (!groupMessage.trim()) return;
    setSendingMessage(true);
    try {
      await sendMessageToGroup(group.id, groupMessage.trim());
      toast.success("Mensagem enviada ao grupo!");
      setMessageOpen(false);
      setGroupMessage("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem");
    } finally {
      setSendingMessage(false);
    }
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

      {/* Actions Card */}
      <Card>
        <CardHeader>
          <CardTitle>Ações</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button variant="outline" onClick={() => setMessageOpen(true)}>
            <Send className="size-4" />
            Enviar mensagem no grupo
          </Button>
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

      {/* Send Message Dialog */}
      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar Mensagem no Grupo</DialogTitle>
            <DialogDescription>
              A mensagem sera enviada para todos os membros do grupo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Mensagem</Label>
            <Textarea
              value={groupMessage}
              onChange={(e) => setGroupMessage(e.target.value)}
              placeholder="Digite sua mensagem..."
              className="min-h-24"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleSendMessage} disabled={sendingMessage || !groupMessage.trim()}>
              {sendingMessage ? "Enviando..." : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
