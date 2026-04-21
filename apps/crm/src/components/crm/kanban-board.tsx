"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, GripVertical, DollarSign, Trash2 } from "lucide-react";
import { createDeal, moveDeal, deleteDeal } from "@/actions/pipelines";

interface Deal {
  id: string;
  title: string;
  value: number;
  status: string;
  lead_id: string | null;
  sort_order: number;
}

interface Stage {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  deals: Deal[];
}

interface Pipeline {
  id: string;
  name: string;
  pipeline_stages: Stage[];
}

export function KanbanBoard({ pipeline }: { pipeline: Pipeline }) {
  const [isPending, startTransition] = useTransition();
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);

  const stages = (pipeline.pipeline_stages || []).sort((a, b) => a.sort_order - b.sort_order);

  function handleDragStart(dealId: string) {
    setDraggedDeal(dealId);
  }

  function handleDrop(stageId: string) {
    if (draggedDeal) {
      startTransition(async () => {
        await moveDeal(draggedDeal, stageId, 0);
      });
      setDraggedDeal(null);
    }
  }

  function handleDeleteDeal(dealId: string) {
    if (!confirm("Excluir este negócio?")) return;
    startTransition(async () => {
      await deleteDeal(dealId);
    });
  }

  const totalValue = stages.reduce(
    (sum, stage) => sum + (stage.deals || []).reduce((s, d) => s + (d.value || 0), 0),
    0
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Badge variant="outline" className="text-sm">
          <DollarSign className="h-3 w-3 mr-1" />
          Total: R$ {totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </Badge>
        <Badge variant="secondary">
          {stages.reduce((sum, s) => sum + (s.deals?.length || 0), 0)} negócios
        </Badge>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <div
            key={stage.id}
            className="flex-shrink-0 w-72"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(stage.id)}
          >
            <div className="rounded-lg border bg-card">
              <div
                className="px-4 py-3 border-b flex items-center justify-between"
                style={{ borderTopColor: stage.color, borderTopWidth: 3, borderTopLeftRadius: 8, borderTopRightRadius: 8 }}
              >
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm">{stage.name}</h3>
                  <Badge variant="secondary" className="text-xs">
                    {stage.deals?.length || 0}
                  </Badge>
                </div>
                <AddDealDialog pipelineId={pipeline.id} stageId={stage.id} />
              </div>

              <div className="p-2 space-y-2 min-h-[200px]">
                {(stage.deals || []).sort((a, b) => a.sort_order - b.sort_order).map((deal) => (
                  <Card
                    key={deal.id}
                    className="cursor-grab active:cursor-grabbing"
                    draggable
                    onDragStart={() => handleDragStart(deal.id)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium">{deal.title}</p>
                            {deal.value > 0 && (
                              <p className="text-xs text-muted-foreground mt-1">
                                R$ {deal.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                              </p>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteDeal(deal.id)}
                          aria-label="Excluir negócio"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddDealDialog({ pipelineId, stageId }: { pipelineId: string; stageId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    formData.set("pipeline_id", pipelineId);
    formData.set("stage_id", stageId);
    startTransition(async () => {
      await createDeal(formData);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Adicionar negócio">
          <Plus className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo Negócio</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Título</Label>
            <Input name="title" required placeholder="Nome do negócio" />
          </div>
          <div className="space-y-2">
            <Label>Valor (R$)</Label>
            <Input name="value" type="number" step="0.01" placeholder="0.00" />
          </div>
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Criando..." : "Criar Negócio"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
