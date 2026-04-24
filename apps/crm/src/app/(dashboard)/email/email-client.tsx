"use client";

import * as React from "react";
import { Plus, Trash2, Send, Mail } from "lucide-react";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
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
import { Textarea } from "@persia/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@persia/ui/table";
import { Card, CardContent } from "@persia/ui/card";
import {
  createEmailCampaign,
  deleteEmailCampaign,
  updateEmailCampaignStatus,
} from "@/actions/email-campaigns";

interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  content: string;
  status: string;
  segment_id: string | null;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  open_rate: number;
  created_at: string;
}

const STATUS_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Rascunho", variant: "secondary" },
  scheduled: { label: "Agendada", variant: "outline" },
  sending: { label: "Enviando", variant: "default" },
  sent: { label: "Enviada", variant: "default" },
  cancelled: { label: "Cancelada", variant: "destructive" },
};

export function EmailPageClient({
  initialCampaigns,
}: {
  initialCampaigns: EmailCampaign[];
}) {
  const [campaigns, setCampaigns] =
    React.useState<EmailCampaign[]>(initialCampaigns);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [content, setContent] = React.useState("");
  const [segmentId, setSegmentId] = React.useState("");

  function openCreateDialog() {
    setName("");
    setSubject("");
    setContent("");
    setSegmentId("");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!name.trim() || !subject.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("subject", subject.trim());
      fd.set("content", content);
      fd.set("segment_id", segmentId);
      const newCampaign = await createEmailCampaign(fd);
      if (newCampaign) {
        setCampaigns((prev) => [
          {
            ...newCampaign,
            total_sent: 0,
            total_opened: 0,
            total_clicked: 0,
            open_rate: 0,
          } as unknown as EmailCampaign,
          ...prev,
        ]);
      }
      setCreateOpen(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleSend(id: string) {
    setSaving(true);
    try {
      await updateEmailCampaignStatus(id, "sending");
      setCampaigns((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "sending" } : c))
      );
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir esta campanha de email?")) return;
    setSaving(true);
    try {
      await deleteEmailCampaign(id);
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreateDialog}>
          <Plus className="size-4" />
          Nova Campanha Email
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Mail className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhuma campanha de email</p>
            <p className="text-sm text-muted-foreground">
              Crie campanhas para engajar seus leads por email
            </p>
            <Button className="mt-4" onClick={openCreateDialog}>
              <Plus className="size-4" />
              Criar primeira campanha
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Enviados</TableHead>
              <TableHead>Taxa Abertura</TableHead>
              <TableHead>Criação</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {c.subject}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={STATUS_MAP[c.status]?.variant || "secondary"}
                  >
                    {STATUS_MAP[c.status]?.label || c.status}
                  </Badge>
                </TableCell>
                <TableCell>{c.total_sent}</TableCell>
                <TableCell>{c.open_rate}%</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {c.status === "draft" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleSend(c.id)}
                        disabled={saving}
                      >
                        <Send className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => handleDelete(c.id)}
                      disabled={saving}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Campanha de Email</DialogTitle>
            <DialogDescription>
              Configure o conteudo e o publico da campanha
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-name">Nome da campanha</Label>
              <Input
                id="email-name"
                placeholder="Ex: Newsletter Marco"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-subject">Assunto do email</Label>
              <Input
                id="email-subject"
                placeholder="Ex: Novidades especiais para voce"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-content">Conteudo</Label>
              <Textarea
                id="email-content"
                rows={6}
                placeholder="Escreva o corpo do email..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-segment">
                ID do Segmento (opcional)
              </Label>
              <Input
                id="email-segment"
                placeholder="ID do segmento alvo"
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              onClick={handleCreate}
              disabled={saving || !name.trim() || !subject.trim()}
            >
              {saving ? "Criando..." : "Criar Campanha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
