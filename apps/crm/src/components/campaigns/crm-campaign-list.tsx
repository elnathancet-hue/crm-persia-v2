"use client";

import { useState, useTransition, useMemo } from "react";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { Card, CardContent } from "@persia/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@persia/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { Input } from "@persia/ui/input";
import {
  Plus, Megaphone, MoreHorizontal, Pause, Play, X, Eye, Search,
} from "lucide-react";
import type { CrmCampaign } from "@persia/shared/crm";
import {
  pauseCampaign, resumeCampaign, cancelCampaign,
} from "@/actions/crm-campaigns";
import { CrmCampaignWizard } from "./crm-campaign-wizard";

const STATUS_UI: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft:      { label: "Rascunho",   variant: "secondary" },
  validating: { label: "Validando",  variant: "outline" },
  scheduled:  { label: "Agendada",   variant: "outline" },
  running:    { label: "Enviando",   variant: "default" },
  paused:     { label: "Pausada",    variant: "secondary" },
  completed:  { label: "Concluída",  variant: "default" },
  cancelled:  { label: "Cancelada",  variant: "destructive" },
  failed:     { label: "Falhou",     variant: "destructive" },
};

const KIND_LABEL: Record<string, string> = {
  lead_campaign:  "Leads",
  group_campaign: "Grupos",
};

interface Props {
  campaigns: CrmCampaign[];
  segments: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  pipelines: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; pipeline_id: string; name: string }>;
  groups: Array<{ id: string; name: string; category: string | null; participant_count: number | null }>;
}

export function CrmCampaignList({ campaigns, segments, tags, pipelines, stages, groups }: Props) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const displayed = useMemo(() => {
    if (!search.trim()) return campaigns;
    const q = search.toLowerCase();
    return campaigns.filter((c) => c.name.toLowerCase().includes(q));
  }, [campaigns, search]);

  function handlePause(id: string) {
    startTransition(async () => { await pauseCampaign(id); });
  }

  function handleResume(id: string) {
    startTransition(async () => { await resumeCampaign(id); });
  }

  function handleCancel(id: string) {
    if (!confirm("Cancelar esta campanha? Jobs pendentes serão cancelados.")) return;
    startTransition(async () => { await cancelCampaign(id); });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar campanha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Button size="sm" onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Nova Campanha
        </Button>
      </div>

      {/* Lista */}
      {displayed.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14">
            <Megaphone className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-base font-medium">
              {search ? "Nenhuma campanha encontrada" : "Nenhuma campanha ainda"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {search
                ? "Tente outro termo de busca"
                : "Crie campanhas para enviar mensagens em massa para leads ou grupos"}
            </p>
            {!search && (
              <Button className="mt-4" size="sm" onClick={() => setWizardOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Criar Campanha
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {KIND_LABEL[c.kind] ?? c.kind}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_UI[c.status]?.variant ?? "secondary"}>
                    {STATUS_UI[c.status]?.label ?? c.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-7 w-7" disabled={isPending} />}>
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Ações</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem render={<a href={`/campaigns/${c.id}`} />}>
                        <Eye className="h-4 w-4 mr-2" /> Ver detalhes
                      </DropdownMenuItem>
                      {(c.status === "scheduled" || c.status === "running") && (
                        <DropdownMenuItem onClick={() => handlePause(c.id)}>
                          <Pause className="h-4 w-4 mr-2" /> Pausar
                        </DropdownMenuItem>
                      )}
                      {c.status === "paused" && (
                        <DropdownMenuItem onClick={() => handleResume(c.id)}>
                          <Play className="h-4 w-4 mr-2" /> Retomar
                        </DropdownMenuItem>
                      )}
                      {c.status !== "completed" && c.status !== "cancelled" && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleCancel(c.id)}
                        >
                          <X className="h-4 w-4 mr-2" /> Cancelar
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Wizard */}
      <CrmCampaignWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        segments={segments}
        tags={tags}
        pipelines={pipelines}
        stages={stages}
        groups={groups}
      />
    </div>
  );
}
