"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Send, Trash2, Megaphone } from "lucide-react";
import { createCampaign, deleteCampaign, updateCampaignStatus } from "@/actions/campaigns";

interface Campaign {
  id: string;
  name: string;
  message: string;
  status: string;
  total_target: number;
  total_sent: number;
  total_delivered: number;
  total_read: number;
  scheduled_at: string | null;
  created_at: string;
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Rascunho", variant: "secondary" },
  scheduled: { label: "Agendada", variant: "outline" },
  sending: { label: "Enviando", variant: "default" },
  completed: { label: "Concluida", variant: "default" },
  cancelled: { label: "Cancelada", variant: "destructive" },
};

export function CampaignList({ campaigns }: { campaigns: Campaign[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function validateField(field: string, value: string, rules: { required?: boolean; minLength?: number }) {
    if (rules.required && !value.trim()) { setError(field, "Campo obrigatório"); return false; }
    if (rules.minLength && value.trim().length < rules.minLength) { setError(field, `Mínimo ${rules.minLength} caracteres`); return false; }
    clearError(field);
    return true;
  }

  function handleCreate(formData: FormData) {
    const name = formData.get("name") as string || "";
    const message = formData.get("message") as string || "";
    let valid = true;
    if (!validateField("campaign_name", name, { required: true })) valid = false;
    if (!validateField("campaign_message", message, { required: true, minLength: 10 })) valid = false;
    if (!valid) return;

    startTransition(async () => {
      await createCampaign(formData);
      setOpen(false);
      setErrors({});
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Excluir esta campanha?")) return;
    startTransition(() => deleteCampaign(id));
  }

  function handleStart(id: string) {
    startTransition(() => updateCampaignStatus(id, "sending"));
  }

  return (
    <div className="space-y-4">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger>
          <Button><Plus className="h-4 w-4 mr-2" /> Nova Campanha</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Criar Campanha</DialogTitle></DialogHeader>
          <form action={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                name="name"
                required
                placeholder="Ex: Promocao de Janeiro"
                onBlur={(e) => validateField("campaign_name", e.target.value, { required: true })}
                onChange={() => clearError("campaign_name")}
                className={errors.campaign_name ? "border-destructive focus-visible:ring-destructive/50" : ""}
              />
              {errors.campaign_name && <p className="text-xs text-destructive mt-1">{errors.campaign_name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Mensagem *</Label>
              <Textarea
                name="message"
                required
                rows={4}
                placeholder="Escreva a mensagem que sera enviada..."
                onBlur={(e) => validateField("campaign_message", e.target.value, { required: true, minLength: 10 })}
                onChange={() => clearError("campaign_message")}
                className={errors.campaign_message ? "border-destructive focus-visible:ring-destructive/50" : ""}
              />
              {errors.campaign_message && <p className="text-xs text-destructive mt-1">{errors.campaign_message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Tags alvo (separadas por virgula)</Label>
              <Input name="target_tags" placeholder="Ex: cliente, interessado" />
            </div>
            <div className="space-y-2">
              <Label>Agendar para (opcional)</Label>
              <Input name="scheduled_at" type="datetime-local" />
            </div>
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Criando..." : "Criar Campanha"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Megaphone className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhuma campanha ainda</p>
            <p className="text-sm text-muted-foreground">Crie campanhas para enviar mensagens em massa</p>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Enviados</TableHead>
              <TableHead>Entregues</TableHead>
              <TableHead>Lidos</TableHead>
              <TableHead>Criação</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_MAP[c.status]?.variant || "secondary"}>
                    {STATUS_MAP[c.status]?.label || c.status}
                  </Badge>
                </TableCell>
                <TableCell>{c.total_sent}</TableCell>
                <TableCell>{c.total_delivered}</TableCell>
                <TableCell>{c.total_read}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {c.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => handleStart(c.id)} aria-label="Iniciar campanha">
                        <Send className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(c.id)} aria-label="Excluir campanha">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
