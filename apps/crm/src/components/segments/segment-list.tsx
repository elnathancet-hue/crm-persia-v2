"use client";

import { useState, useTransition } from "react";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Plus, Users, Trash2, Pencil } from "lucide-react";
import { createSegment, deleteSegment } from "@/actions/segments";
import { ConditionBuilder } from "./condition-builder";
import { useRole } from "@/lib/hooks/use-role";
import type { Segment } from "@persia/shared/crm";

export function SegmentList({ segments }: { segments: Segment[] }) {
  const { isAdmin } = useRole(); // only admin+ can create/edit/delete segments
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [rules, setRules] = useState({ operator: "AND", conditions: [] as any[] });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function handleCreate(formData: FormData) {
    const name = formData.get("name") as string || "";
    if (!name.trim()) { setError("segment_name", "Campo obrigatório"); return; }
    clearError("segment_name");

    formData.set("rules", JSON.stringify(rules));
    startTransition(async () => {
      await createSegment(formData);
      setOpen(false);
      setRules({ operator: "AND", conditions: [] });
      setErrors({});
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Excluir esta segmentação?")) return;
    startTransition(async () => {
      await deleteSegment(id);
    });
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nova Segmentação
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Criar Segmentação</DialogTitle>
          </DialogHeader>
          <form action={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                name="name"
                required
                placeholder="Ex: Leads inativos há 30 dias"
                onBlur={(e) => { if (!e.target.value.trim()) setError("segment_name", "Campo obrigatório"); else clearError("segment_name"); }}
                onChange={() => clearError("segment_name")}
                className={errors.segment_name ? "border-destructive focus-visible:ring-destructive/50" : ""}
              />
              {errors.segment_name && <p className="text-xs text-destructive mt-1">{errors.segment_name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Textarea name="description" placeholder="Descreva o objetivo desta segmentação" />
            </div>
            <div className="space-y-2">
              <Label>Regras</Label>
              <ConditionBuilder rules={rules} onChange={setRules} />
            </div>
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Criando..." : "Criar Segmentação"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      )}

      {segments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhuma segmentação ainda</p>
            <p className="text-sm text-muted-foreground">Crie segmentos para agrupar leads por criterios</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {segments.map((segment) => (
            <Card key={segment.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                  <CardTitle className="text-base">{segment.name}</CardTitle>
                  {segment.description && (
                    <p className="text-xs text-muted-foreground mt-1">{segment.description}</p>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar segmento">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(segment.id)}
                      aria-label="Excluir segmento"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">
                    <Users className="h-3 w-3 mr-1" />
                    {segment.lead_count} leads
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {segment.rules?.conditions?.length || 0} regras
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
