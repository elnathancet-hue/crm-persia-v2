"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { EmptyState } from "@persia/ui/empty-state";
import { StatusBadge } from "@persia/ui/status-badge";
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
import {
  createGroup,
  syncGroups,
  getGroupsOverview,
  type GroupOverview,
} from "@/actions/groups";

const CATEGORY_LABELS: Record<string, string> = {
  geral: "Geral",
  aquecimento: "Aquecimento",
  evento: "Evento",
  oferta: "Oferta",
  alunos: "Alunos",
};

function exportGroupCSV(group: GroupOverview) {
  const header = "Grupo,Campanha,Ocupação,Leads Identificados,Duplicados,Status\n";
  const row = `"${group.name}","${group.campaign_name ?? ""}","${group.participant_count}/${group.max_participants}",${group.identified_leads},${group.duplicates},"${group.is_accepting ? "Ativo" : "Lotado"}"`;
  const blob = new Blob([header + row], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${group.name.replace(/[^a-z0-9]/gi, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportAllCSV(groups: GroupOverview[]) {
  const header = "Grupo,Campanha,Ocupação,Leads Identificados,Duplicados,Status\n";
  const rows = groups
    .map(
      (g) =>
        `"${g.name}","${g.campaign_name ?? ""}","${g.participant_count}/${g.max_participants}",${g.identified_leads},${g.duplicates},"${g.is_accepting ? "Ativo" : "Lotado"}"`,
    )
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "grupos.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function GroupsTab() {
  const router = useRouter();
  const [groups, setGroups] = React.useState<GroupOverview[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [syncing, setSyncing] = React.useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newCategory, setNewCategory] = React.useState("geral");
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    getGroupsOverview()
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await syncGroups();
      toast.success(`${result.synced} grupos sincronizados`);
      const fresh = await getGroupsOverview();
      setGroups(fresh);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createGroup(newName.trim(), [], newCategory);
      toast.success("Grupo criado");
      setCreateOpen(false);
      setNewName("");
      setNewCategory("geral");
      const fresh = await getGroupsOverview();
      setGroups(fresh);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao criar grupo");
    } finally {
      setCreating(false);
    }
  }

  const filtered = groups.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      (g.campaign_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const totalDuplicates = groups.reduce((acc, g) => acc + g.duplicates, 0);
  const totalParticipants = groups.reduce((acc, g) => acc + g.participant_count, 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Input
            name="search-groups"
            placeholder="Buscar grupo ou campanha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-72"
          />
          {totalDuplicates > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-warning-soft text-warning shrink-0">
              <AlertTriangle className="size-3" />
              {totalDuplicates} duplicado{totalDuplicates !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportAllCSV(groups)}
            disabled={groups.length === 0}
          >
            <Download className="size-4" />
            Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Sincronizar
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Criar grupo
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="subtle"
          icon={<Users />}
          title={search ? "Nenhum grupo encontrado" : "Nenhum grupo ainda"}
          description={
            search
              ? "Tente outro termo de busca"
              : "Crie um grupo ou sincronize do WhatsApp"
          }
          action={
            !search ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Criar grupo
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Grupo
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Campanha
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Ocupação
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Leads identificados
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Duplicados
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-2 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map((group) => {
                  const pct = Math.min(
                    100,
                    Math.round(
                      (group.participant_count / (group.max_participants || 256)) * 100,
                    ),
                  );
                  const isFull = !group.is_accepting || pct >= 100;

                  return (
                    <tr key={group.id} className="hover:bg-muted/30 transition-colors">
                      {/* Grupo */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Users className="size-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[180px]">
                              {group.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {CATEGORY_LABELS[group.category] || group.category}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Campanha */}
                      <td className="px-4 py-3">
                        {group.campaign_name ? (
                          <Badge variant="secondary" className="text-xs font-normal">
                            {group.campaign_name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* Ocupação */}
                      <td className="px-4 py-3">
                        <div className="space-y-1.5 min-w-[120px]">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium tabular-nums">
                              {group.participant_count}/{group.max_participants}
                            </span>
                            <span className="text-muted-foreground">{pct}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isFull
                                  ? "bg-failure"
                                  : pct > 80
                                    ? "bg-warning"
                                    : "bg-primary"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Leads identificados */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium tabular-nums">
                            {group.identified_leads}
                          </span>
                          {group.identified_leads > 0 && (
                            <CheckCircle2 className="size-3.5 text-success shrink-0" />
                          )}
                        </div>
                      </td>

                      {/* Duplicados */}
                      <td className="px-4 py-3">
                        {group.duplicates > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium tabular-nums text-warning">
                              {group.duplicates}
                            </span>
                            <AlertTriangle className="size-3.5 text-warning shrink-0" />
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge kind={isFull ? "warning" : "success"}>
                          {isFull ? "Lotado" : "Ativo"}
                        </StatusBadge>
                      </td>

                      {/* Actions */}
                      <td className="px-2 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title="Ações" />}>
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push("/groups")}>
                              <MessageSquare className="size-4" />
                              Ver chat
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => exportGroupCSV(group)}>
                              <Download className="size-4" />
                              Exportar dados
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          <div className="border-t px-4 py-2 flex items-center justify-between text-xs text-muted-foreground bg-muted/20">
            <span>
              {filtered.length} grupo{filtered.length !== 1 ? "s" : ""}
            </span>
            <span>{totalParticipants} participantes totais</span>
          </div>
        </div>
      )}

      {/* Create group dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar Grupo</DialogTitle>
            <DialogDescription>
              Cria um novo grupo no WhatsApp com link de convite automático.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Grupo</Label>
              <Input
                name="new-group-name"
                placeholder="Ex: Grupo VIP - Lançamento X"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={newCategory}
                onValueChange={(v) => setNewCategory(v ?? "geral")}
              >
                <SelectTrigger>
                  <SelectValue>
                    {CATEGORY_LABELS[newCategory] ?? "Selecione"}
                  </SelectValue>
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
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? "Criando..." : "Criar Grupo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
