"use client";

import { useEffect, useState } from "react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { Plus, X } from "lucide-react";

interface Condition {
  field: string;
  op: string;
  value: string;
}

interface Rules {
  operator: string;
  conditions: Condition[];
}

const FIELDS = [
  { value: "status", label: "Status" },
  { value: "source", label: "Origem" },
  { value: "channel", label: "Canal" },
  { value: "score", label: "Score" },
  { value: "tags", label: "Tags" },
  { value: "created_at", label: "Data de criação" },
  { value: "last_interaction_at", label: "Última interação" },
];

const OPERATORS: Record<string, { value: string; label: string }[]> = {
  status: [
    { value: "eq", label: "igual a" },
    { value: "neq", label: "diferente de" },
  ],
  source: [
    { value: "eq", label: "igual a" },
    { value: "neq", label: "diferente de" },
  ],
  channel: [{ value: "eq", label: "igual a" }],
  score: [
    { value: "gt", label: "maior que" },
    { value: "lt", label: "menor que" },
    { value: "gte", label: "maior ou igual" },
    { value: "lte", label: "menor ou igual" },
  ],
  tags: [
    { value: "contains", label: "contem" },
    { value: "not_contains", label: "nao contem" },
  ],
  created_at: [
    { value: "older_than_days", label: "ha mais de X dias" },
    { value: "newer_than_days", label: "ha menos de X dias" },
  ],
  last_interaction_at: [
    { value: "older_than_days", label: "ha mais de X dias" },
    { value: "newer_than_days", label: "ha menos de X dias" },
    { value: "is_null", label: "nunca interagiu" },
  ],
};

function genId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function ConditionBuilder({
  rules,
  onChange,
}: {
  rules: Rules;
  onChange: (r: Rules) => void;
}) {
  const [ids, setIds] = useState<string[]>(() =>
    rules.conditions.map(() => genId()),
  );

  useEffect(() => {
    setIds((prev) => {
      const target = rules.conditions.length;
      if (prev.length === target) return prev;
      if (prev.length < target) {
        const extras = Array.from({ length: target - prev.length }, () =>
          genId(),
        );
        return [...prev, ...extras];
      }
      return prev.slice(0, target);
    });
  }, [rules.conditions.length]);

  function addCondition() {
    setIds((prev) => [...prev, genId()]);
    onChange({
      ...rules,
      conditions: [
        ...rules.conditions,
        { field: "status", op: "eq", value: "" },
      ],
    });
  }

  function removeCondition(index: number) {
    setIds((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    onChange({
      ...rules,
      conditions: rules.conditions.filter((_, i) => i !== index),
    });
  }

  function updateCondition(index: number, updates: Partial<Condition>) {
    const newConditions = [...rules.conditions];
    newConditions[index] = { ...newConditions[index], ...updates };
    onChange({ ...rules, conditions: newConditions });
  }

  function toggleOperator() {
    onChange({
      ...rules,
      operator: rules.operator === "AND" ? "OR" : "AND",
    });
  }

  return (
    <div className="space-y-3 border rounded-lg p-4">
      {rules.conditions.length > 1 && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-muted-foreground">Combinar com:</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleOperator}
          >
            {rules.operator === "AND" ? "E (todas)" : "OU (qualquer)"}
          </Button>
        </div>
      )}

      {rules.conditions.map((condition, index) => (
        <div
          key={ids[index] ?? `cond-${index}`}
          className="flex items-center gap-2"
        >
          <Select
            value={condition.field}
            onValueChange={(v) =>
              updateCondition(index, {
                field: v ?? "status",
                op: OPERATORS[v ?? "status"]?.[0]?.value || "eq",
              })
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELDS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={condition.op}
            onValueChange={(v) => updateCondition(index, { op: v ?? "eq" })}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(OPERATORS[condition.field] || []).map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {condition.op !== "is_null" && (
            <Input
              value={condition.value}
              onChange={(e) =>
                updateCondition(index, { value: e.target.value })
              }
              placeholder="Valor"
              className="flex-1"
            />
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => removeCondition(index)}
            aria-label="Remover regra"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addCondition}
      >
        <Plus className="h-4 w-4 mr-1" />
        Adicionar regra
      </Button>
    </div>
  );
}
