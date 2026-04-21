"use client";

import * as React from "react";
import { Plus, Pencil, Trash2, Users, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { createQueue, updateQueue, deleteQueue } from "@/actions/queues";

interface Queue {
  id: string;
  name: string;
  description: string | null;
  distribution_type: string;
  member_count: number;
  created_at: string;
}

const DISTRIBUTION_LABELS: Record<string, string> = {
  round_robin: "Round Robin",
  random: "Aleatorio",
  least_busy: "Menos Ocupado",
  manual: "Manual",
};

export function QueuesPageClient({
  initialQueues,
}: {
  initialQueues: Queue[];
}) {
  const [queues, setQueues] = React.useState<Queue[]>(initialQueues);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [editingQueue, setEditingQueue] = React.useState<Queue | null>(null);
  const [deletingQueue, setDeletingQueue] = React.useState<Queue | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [distributionType, setDistributionType] = React.useState("round_robin");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function openCreateDialog() {
    setEditingQueue(null);
    setName("");
    setDescription("");
    setDistributionType("round_robin");
    setErrors({});
    setDialogOpen(true);
  }

  function openEditDialog(queue: Queue) {
    setEditingQueue(queue);
    setName(queue.name);
    setDescription(queue.description || "");
    setDistributionType(queue.distribution_type);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) { setError("queue_name", "Campo obrigatório"); return; }
    clearError("queue_name");
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("description", description);
      fd.set("distribution_type", distributionType);

      if (editingQueue) {
        await updateQueue(editingQueue.id, fd);
        setQueues((prev) =>
          prev.map((q) =>
            q.id === editingQueue.id
              ? {
                  ...q,
                  name: name.trim(),
                  description: description || null,
                  distribution_type: distributionType,
                }
              : q
          )
        );
      } else {
        const newQueue = await createQueue(fd);
        if (newQueue) {
          setQueues((prev) => [
            { ...newQueue, member_count: 0 } as Queue,
            ...prev,
          ]);
        }
      }
      setDialogOpen(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  function openDeleteDialog(queue: Queue) {
    setDeletingQueue(queue);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deletingQueue) return;
    setSaving(true);
    try {
      await deleteQueue(deletingQueue.id);
      setQueues((prev) => prev.filter((q) => q.id !== deletingQueue.id));
      setDeleteOpen(false);
      setDeletingQueue(null);
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
          Nova Fila
        </Button>
      </div>

      {queues.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ListFilter className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhuma fila criada</p>
            <p className="text-sm text-muted-foreground">
              Crie filas para distribuir leads entre sua equipe
            </p>
            <Button className="mt-4" onClick={openCreateDialog}>
              <Plus className="size-4" />
              Criar primeira fila
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Distribuição</TableHead>
              <TableHead>Membros</TableHead>
              <TableHead>Criação</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queues.map((queue) => (
              <TableRow key={queue.id}>
                <TableCell className="font-medium">{queue.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {queue.description || "-"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {DISTRIBUTION_LABELS[queue.distribution_type] ||
                      queue.distribution_type}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Users className="size-3.5 text-muted-foreground" />
                    {queue.member_count}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(queue.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(queue)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => openDeleteDialog(queue)}
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

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingQueue ? "Editar Fila" : "Nova Fila de Atendimento"}
            </DialogTitle>
            <DialogDescription>
              {editingQueue
                ? "Altere as configuracoes da fila"
                : "Configure como os leads serao distribuidos"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="q-name">Nome *</Label>
              <Input
                id="q-name"
                placeholder="Ex: Suporte Nivel 1"
                value={name}
                onChange={(e) => { setName(e.target.value); clearError("queue_name"); }}
                onBlur={() => { if (!name.trim()) setError("queue_name", "Campo obrigatório"); else clearError("queue_name"); }}
                className={errors.queue_name ? "border-destructive focus-visible:ring-destructive/50" : ""}
              />
              {errors.queue_name && <p className="text-xs text-destructive mt-1">{errors.queue_name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-desc">Descrição (opcional)</Label>
              <Textarea
                id="q-desc"
                rows={2}
                placeholder="Descreva o propósito desta fila..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de Distribuicao</Label>
              <Select
                value={distributionType}
                onValueChange={(v) => setDistributionType(v ?? "round_robin")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                  <SelectItem value="random">Aleatorio</SelectItem>
                  <SelectItem value="least_busy">Menos Ocupado</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving
                ? "Salvando..."
                : editingQueue
                ? "Salvar"
                : "Criar Fila"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Fila</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a fila{" "}
              <strong>{deletingQueue?.name}</strong>? Os membros serao desvinculados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={saving}
            >
              {saving ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
