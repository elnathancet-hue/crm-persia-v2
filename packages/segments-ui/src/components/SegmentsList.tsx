"use client";

// SegmentsList — view de listagem de segmentos com builder de regras
// inline. Compartilhada entre CRM (cliente) e Admin (superadmin). Auth/
// role moram nos apps; o pacote recebe permissoes (canManage) via prop e
// actions via <SegmentsProvider>.
//
// Originalmente em apps/crm/src/components/segments/segment-list.tsx.

import { useEffect, useState, useTransition } from "react";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Plus, Users, Trash2, Pencil } from "lucide-react";
import type { Segment, SegmentRules } from "@persia/shared/crm";

import { ConditionBuilder } from "./ConditionBuilder";
import { useSegmentsActions } from "../context";

interface RulesShape {
  operator: "AND" | "OR";
  conditions: Array<{ field: string; op: string; value: string }>;
}

const EMPTY_RULES: RulesShape = { operator: "AND", conditions: [] };

export interface SegmentsListProps {
  initialSegments: Segment[];
  /** admin+: pode criar/editar/deletar segmentos. CRM = admin+; admin app = sempre true. */
  canManage: boolean;
}

export function SegmentsList({
  initialSegments,
  canManage,
}: SegmentsListProps) {
  const actions = useSegmentsActions();
  const [segments, setSegments] = useState<Segment[]>(initialSegments);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<RulesShape>(EMPTY_RULES);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sync com prop quando o pai re-fetcha.
  useEffect(() => {
    setSegments(initialSegments);
  }, [initialSegments]);

  function setError(field: string, msg: string) {
    setErrors((prev) => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors((prev) => {
      const n = { ...prev };
      delete n[field];
      return n;
    });
  }

  function openCreateDialog() {
    setEditingSegment(null);
    setName("");
    setDescription("");
    setRules(EMPTY_RULES);
    setErrors({});
    setOpen(true);
  }

  function openEditDialog(segment: Segment) {
    setEditingSegment(segment);
    setName(segment.name);
    setDescription(segment.description ?? "");
    const segRules = segment.rules as Partial<RulesShape> | null;
    setRules({
      operator: segRules?.operator === "OR" ? "OR" : "AND",
      conditions: segRules?.conditions ?? [],
    });
    setErrors({});
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      setError("segment_name", "Campo obrigatório");
      return;
    }
    clearError("segment_name");

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      rules: rules as unknown as SegmentRules,
    };

    startTransition(async () => {
      try {
        if (editingSegment) {
          await actions.updateSegment(editingSegment.id, payload);
          setSegments((prev) =>
            prev.map((s) =>
              s.id === editingSegment.id
                ? {
                    ...s,
                    name: payload.name,
                    description: payload.description ?? null,
                    rules: payload.rules,
                  }
                : s,
            ),
          );
        } else {
          const created = await actions.createSegment(payload);
          if (created) {
            setSegments((prev) => [created, ...prev]);
          }
        }
        setOpen(false);
      } catch {
        // silently fail
      }
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm("Excluir esta segmentação?")) return;
    startTransition(async () => {
      try {
        await actions.deleteSegment(id);
        setSegments((prev) => prev.filter((s) => s.id !== id));
      } catch {
        // silently fail
      }
    });
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Segmentação
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingSegment ? "Editar" : "Criar"} Segmentação
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearError("segment_name");
                  }}
                  required
                  placeholder="Ex: Leads inativos há 30 dias"
                  onBlur={(e) => {
                    if (!e.target.value.trim())
                      setError("segment_name", "Campo obrigatório");
                    else clearError("segment_name");
                  }}
                  className={
                    errors.segment_name
                      ? "border-destructive focus-visible:ring-destructive/50"
                      : ""
                  }
                />
                {errors.segment_name && (
                  <p className="text-xs text-destructive mt-1">
                    {errors.segment_name}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Descrição (opcional)</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descreva o objetivo desta segmentação"
                />
              </div>
              <div className="space-y-2">
                <Label>Regras</Label>
                <ConditionBuilder
                  rules={rules}
                  onChange={(next) =>
                    setRules({
                      operator: next.operator === "OR" ? "OR" : "AND",
                      conditions: next.conditions,
                    })
                  }
                />
              </div>
              <Button
                type="submit"
                disabled={isPending}
                className="w-full"
              >
                {isPending
                  ? editingSegment
                    ? "Salvando..."
                    : "Criando..."
                  : editingSegment
                    ? "Salvar"
                    : "Criar Segmentação"}
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
            <p className="text-sm text-muted-foreground">
              Crie segmentos para agrupar leads por criterios
            </p>
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
                    <p className="text-xs text-muted-foreground mt-1">
                      {segment.description}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditDialog(segment)}
                      aria-label="Editar segmento"
                    >
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
