"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, Copy, Power, PowerOff, Workflow, Zap } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@persia/ui/table";
import { Card, CardContent } from "@persia/ui/card";
import { createFlow, deleteFlow, duplicateFlow, updateFlow } from "@/actions/flows";

interface Flow {
  id: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  nodes: any[];
  edges: any[];
  executions_count: number;
  created_at: string;
  updated_at: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  lead_created: "Lead Criado",
  lead_updated: "Lead Atualizado",
  tag_added: "Tag Adicionada",
  message_received: "Mensagem Recebida",
  webhook: "Webhook",
};

export function FlowsPageClient({ initialFlows }: { initialFlows: Flow[] }) {
  const [flows, setFlows] = React.useState<Flow[]>(initialFlows);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deletingFlow, setDeletingFlow] = React.useState<Flow | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [triggerType, setTriggerType] = React.useState("manual");

  function openCreateDialog() {
    setName("");
    setTriggerType("manual");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("trigger_type", triggerType);
      const newFlow = await createFlow(fd);
      if (newFlow) {
        setFlows((prev) => [{ ...newFlow, executions_count: 0 } as Flow, ...prev]);
      }
      setCreateOpen(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(id: string) {
    setSaving(true);
    try {
      const dup = await duplicateFlow(id);
      if (dup) {
        setFlows((prev) => [{ ...dup, executions_count: 0 } as Flow, ...prev]);
      }
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(flow: Flow) {
    setSaving(true);
    try {
      await updateFlow(flow.id, { is_active: !flow.is_active });
      setFlows((prev) =>
        prev.map((f) => (f.id === flow.id ? { ...f, is_active: !f.is_active } : f))
      );
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  function openDeleteDialog(flow: Flow) {
    setDeletingFlow(flow);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deletingFlow) return;
    setSaving(true);
    try {
      await deleteFlow(deletingFlow.id);
      setFlows((prev) => prev.filter((f) => f.id !== deletingFlow.id));
      setDeleteOpen(false);
      setDeletingFlow(null);
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
          Criar Fluxo
        </Button>
      </div>

      {flows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Workflow className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhum fluxo criado</p>
            <p className="text-sm text-muted-foreground">
              Crie fluxos de automação para seus leads
            </p>
            <Button className="mt-4" onClick={openCreateDialog}>
              <Plus className="size-4" />
              Criar primeiro fluxo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Gatilho</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>Criação</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flows.map((flow) => (
              <TableRow key={flow.id}>
                <TableCell>
                  <Link
                    href={`/flows/${flow.id}`}
                    className="font-medium hover:underline"
                  >
                    {flow.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={flow.is_active ? "default" : "secondary"}>
                    {flow.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 text-sm">
                    <Zap className="size-3.5 text-muted-foreground" />
                    {TRIGGER_LABELS[flow.trigger_type] || flow.trigger_type}
                  </div>
                </TableCell>
                <TableCell>{flow.executions_count}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(flow.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Link href={`/flows/${flow.id}`}>
                      <Button variant="ghost" size="icon">
                        <Pencil className="size-3.5" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDuplicate(flow.id)}
                      disabled={saving}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggleActive(flow)}
                      disabled={saving}
                    >
                      {flow.is_active ? (
                        <PowerOff className="size-3.5 text-destructive" />
                      ) : (
                        <Power className="size-3.5 text-green-600" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => openDeleteDialog(flow)}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar Fluxo</DialogTitle>
            <DialogDescription>
              Defina o nome e o gatilho do novo fluxo de automação
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="flow-name">Nome</Label>
              <Input
                id="flow-name"
                placeholder="Ex: Boas-vindas novo lead"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Gatilho</Label>
              <Select
                value={triggerType}
                onValueChange={(v) => setTriggerType(v ?? "manual")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o gatilho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="lead_created">Lead Criado</SelectItem>
                  <SelectItem value="lead_updated">Lead Atualizado</SelectItem>
                  <SelectItem value="tag_added">Tag Adicionada</SelectItem>
                  <SelectItem value="message_received">Mensagem Recebida</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleCreate} disabled={saving || !name.trim()}>
              {saving ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Fluxo</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o fluxo{" "}
              <strong>{deletingFlow?.name}</strong>? Todas as execucoes serao removidas.
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
