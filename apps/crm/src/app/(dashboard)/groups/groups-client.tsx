"use client";

import * as React from "react";
import Link from "next/link";
import {
  Plus,
  RefreshCw,
  Copy,
  Users,
  Megaphone,
  Link2,
  Loader2,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Card, CardContent } from "@persia/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { createGroup, syncGroups, deleteGroup } from "@/actions/groups";
import { toast } from "sonner";

interface Group {
  id: string;
  organization_id: string;
  group_jid: string;
  name: string;
  description: string | null;
  invite_link: string | null;
  participant_count: number;
  is_announce: boolean;
  category: string;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  geral: "Geral",
  aquecimento: "Aquecimento",
  evento: "Evento",
  oferta: "Oferta",
  alunos: "Alunos",
};

// PR-COLOR-SWEEP: categorias de grupos mapeadas pros tokens do DS.
const CATEGORY_COLORS: Record<string, string> = {
  geral: "bg-muted text-muted-foreground",
  aquecimento: "bg-warning-soft text-warning-soft-foreground",
  evento: "bg-primary/10 text-primary",
  oferta: "bg-success-soft text-success-soft-foreground",
  alunos: "bg-progress-soft text-progress-soft-foreground",
};

export function GroupsClient({ initialGroups }: { initialGroups: Group[] }) {
  const [groups, setGroups] = React.useState<Group[]>(initialGroups);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("geral");

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await syncGroups();
      toast.success(`${result.synced} grupos sincronizados`);
      window.location.reload();
    } catch (err: any) {
      toast.error(err.message || "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const newGroup = await createGroup(name.trim(), category);
      setGroups((prev) => [newGroup as Group, ...prev]);
      setCreateOpen(false);
      setName("");
      setCategory("geral");
      toast.success("Grupo criado");
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar grupo");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteGroup(id);
      setGroups((prev) => prev.filter((g) => g.id !== id));
      toast.success("Grupo removido");
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
  }

  function copyInviteLink(link: string | null) {
    if (!link) {
      toast.error("Sem link de convite");
      return;
    }
    navigator.clipboard.writeText(link);
    toast.success("Link copiado!");
  }

  return (
    <>
      {/* Actions bar */}
      <div className="flex items-center gap-3">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Criar Grupo
        </Button>
        <Button variant="outline" onClick={handleSync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Sincronizar
        </Button>
        <Badge variant="secondary" className="ml-auto rounded-full px-3 py-1">
          {groups.length} grupos
        </Badge>
      </div>

      {/* Groups list */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="size-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Users className="size-7 text-muted-foreground/60" />
            </div>
            <p className="text-base font-semibold">Nenhum grupo</p>
            <p className="text-sm text-muted-foreground mt-1">
              Crie um grupo ou sincronize os grupos existentes do WhatsApp
            </p>
            <div className="flex gap-3 mt-4">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Criar Grupo
              </Button>
              <Button variant="outline" onClick={handleSync} disabled={syncing}>
                <RefreshCw className="size-4" />
                Sincronizar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => (
            <Card
              key={group.id}
              className="hover:border-primary/30 transition-colors"
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/groups/${group.id}`}
                      className="font-semibold text-sm hover:text-primary transition-colors truncate block"
                    >
                      {group.name}
                    </Link>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 ${CATEGORY_COLORS[group.category] || ""}`}
                      >
                        {CATEGORY_LABELS[group.category] || group.category}
                      </Badge>
                      {group.is_announce && (
                        <Badge variant="outline" className="text-[10px] px-1.5">
                          <Megaphone className="size-2.5 mr-0.5" />
                          Anuncio
                        </Badge>
                      )}
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <Button variant="ghost" size="icon-sm" className="size-7">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => copyInviteLink(group.invite_link)}>
                        <Copy className="size-4" />
                        Copiar link
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => handleDelete(group.id)}
                      >
                        <Trash2 className="size-4" />
                        Remover
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Info */}
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Users className="size-3" />
                    {group.participant_count} membros
                  </div>
                  {group.invite_link && (
                    <button
                      onClick={() => copyInviteLink(group.invite_link)}
                      className="flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      <Link2 className="size-3" />
                      Copiar link
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar Grupo</DialogTitle>
            <DialogDescription>
              Cria um novo grupo no WhatsApp. O link de convite sera gerado automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Grupo</Label>
              <Input
                placeholder="Ex: Grupo VIP - Lancamento X"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={category} onValueChange={(v) => setCategory(v ?? "geral")}>
                <SelectTrigger className="w-full">
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
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? "Criando..." : "Criar Grupo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
