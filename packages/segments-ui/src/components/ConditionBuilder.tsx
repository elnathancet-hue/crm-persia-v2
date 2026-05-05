"use client";

// ConditionBuilder — UI de regras pra segmentos.
//
// PR-CRMUI (mai/2026): redesign visual.
//   - Labels traduzidos pra PT-BR (campos + operadores).
//   - Toggle E/OU no topo via pill segmentada (substitui o "Combinar
//     com:" antigo).
//   - Conector visual "E"/"OU" entre regras (badge centralizada).
//   - Linha de regra responsive (flex-wrap, alturas consistentes h-9).
//   - Placeholder do valor amigavel ("Selecione ou digite um valor").
//   - Microtexto explicativo no topo.

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

// PR-CRMUI: labels traduzidos. Mantem `value` (chave interna) compativel
// com o backend (helper findMatchingLeadIds + schema do segmento) — so
// o `label` mudou.
const FIELDS = [
  { value: "status", label: "Status" },
  { value: "source", label: "Origem" },
  { value: "channel", label: "Canal" },
  { value: "score", label: "Score" },
  { value: "tags", label: "Tags" },
  { value: "assigned_to", label: "Responsável" },
  { value: "created_at", label: "Data de criação" },
  { value: "last_interaction_at", label: "Última atividade" },
];

const OPERATORS: Record<string, { value: string; label: string }[]> = {
  status: [
    { value: "eq", label: "é igual a" },
    { value: "neq", label: "é diferente de" },
  ],
  source: [
    { value: "eq", label: "é igual a" },
    { value: "neq", label: "é diferente de" },
  ],
  channel: [{ value: "eq", label: "é igual a" }],
  score: [
    { value: "gt", label: "maior que" },
    { value: "lt", label: "menor que" },
    { value: "gte", label: "maior ou igual" },
    { value: "lte", label: "menor ou igual" },
  ],
  tags: [
    { value: "contains", label: "contém" },
    { value: "not_contains", label: "não contém" },
  ],
  assigned_to: [
    { value: "eq", label: "é" },
    { value: "neq", label: "não é" },
    { value: "is_null", label: "sem responsável" },
  ],
  created_at: [
    { value: "older_than_days", label: "há mais de X dias" },
    { value: "newer_than_days", label: "há menos de X dias" },
  ],
  last_interaction_at: [
    { value: "older_than_days", label: "há mais de X dias" },
    { value: "newer_than_days", label: "há menos de X dias" },
    { value: "is_null", label: "nunca interagiu" },
  ],
};

function genId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

/** Opcao do dropdown "Responsavel" — caller passa a lista de members. */
export interface AssigneeOption {
  id: string;
  name: string;
}

export function ConditionBuilder({
  rules,
  onChange,
  assigneeOptions = [],
}: {
  rules: Rules;
  onChange: (r: Rules) => void;
  assigneeOptions?: AssigneeOption[];
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

  function setOperator(next: "AND" | "OR") {
    if (rules.operator === next) return;
    onChange({ ...rules, operator: next });
  }

  const hasConditions = rules.conditions.length > 0;
  const isAnd = rules.operator !== "OR"; // default AND

  return (
    <div className="space-y-3">
      {/* Toggle E/OU — sempre visivel pra contexto, ate sem regras ainda.
          PR-CRMUI: pill segmentada substitui o "Combinar com:" antigo. */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {isAnd
            ? "Todas as regras precisam ser atendidas"
            : "Pelo menos uma regra precisa ser atendida"}
        </span>
        <div
          role="radiogroup"
          aria-label="Combinador de regras"
          className="inline-flex items-center rounded-md border border-border bg-card p-0.5 text-xs font-medium"
        >
          <button
            type="button"
            role="radio"
            aria-checked={isAnd}
            onClick={() => setOperator("AND")}
            className={`rounded px-3 py-1 transition-colors ${
              isAnd
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Todas (E)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!isAnd}
            onClick={() => setOperator("OR")}
            className={`rounded px-3 py-1 transition-colors ${
              !isAnd
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Qualquer (OU)
          </button>
        </div>
      </div>

      {/* Lista de regras com conector visual entre linhas */}
      <div className="space-y-2">
        {rules.conditions.map((condition, index) => {
          const isLast = index === rules.conditions.length - 1;
          return (
            <div key={ids[index] ?? `cond-${index}`}>
              <ConditionRow
                condition={condition}
                onUpdate={(updates) => updateCondition(index, updates)}
                onRemove={() => removeCondition(index)}
                assigneeOptions={assigneeOptions}
              />
              {/* Conector E/OU entre regras (nao mostra apos a ultima) */}
              {!isLast && (
                <div className="flex items-center gap-2 py-1.5 pl-2">
                  <span className="h-px flex-1 bg-border/60" aria-hidden />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {isAnd ? "E" : "OU"}
                  </span>
                  <span className="h-px flex-1 bg-border/60" aria-hidden />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!hasConditions && (
        <p className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          Nenhuma regra ainda. Clique em <strong>Adicionar regra</strong>{" "}
          pra começar.
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addCondition}
        className="h-8 rounded-md gap-1.5"
      >
        <Plus className="size-3.5" />
        Adicionar regra
      </Button>
    </div>
  );
}

// ============ ConditionRow — linha individual de regra ============

function ConditionRow({
  condition,
  onUpdate,
  onRemove,
  assigneeOptions,
}: {
  condition: Condition;
  onUpdate: (updates: Partial<Condition>) => void;
  onRemove: () => void;
  assigneeOptions: AssigneeOption[];
}) {
  // Selects e Input com altura padrao h-9 (DesignFlow). flex-wrap em
  // telas <sm pra nao espremer. Botao remover alinhado vertical.
  const showValueInput = condition.op !== "is_null";
  const useAssigneeDropdown =
    condition.field === "assigned_to" && assigneeOptions.length > 0;

  // Resolve o label do field selecionado pra renderizar no <SelectValue>
  // (corrige o "value cru" no SSR antes do SelectContent montar — bug
  // documentado em feedback_select_ssr).
  const fieldLabel =
    FIELDS.find((f) => f.value === condition.field)?.label ?? condition.field;
  const opLabel =
    OPERATORS[condition.field]?.find((o) => o.value === condition.op)?.label ??
    condition.op;
  const assigneeLabel =
    assigneeOptions.find((a) => a.id === condition.value)?.name ??
    "Selecione responsável";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card p-2">
      <Select
        value={condition.field}
        onValueChange={(v) =>
          onUpdate({
            field: v ?? "status",
            op: OPERATORS[v ?? "status"]?.[0]?.value || "eq",
            value: "",
          })
        }
      >
        <SelectTrigger className="h-9 w-full sm:w-44">
          <SelectValue>{fieldLabel}</SelectValue>
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
        onValueChange={(v) => onUpdate({ op: v ?? "eq" })}
      >
        <SelectTrigger className="h-9 w-full sm:w-44">
          <SelectValue>{opLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(OPERATORS[condition.field] || []).map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showValueInput && (
        useAssigneeDropdown ? (
          <Select
            value={condition.value}
            onValueChange={(v) => onUpdate({ value: v ?? "" })}
          >
            <SelectTrigger className="h-9 min-w-0 flex-1">
              <SelectValue>{assigneeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {assigneeOptions.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={condition.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder="Selecione ou digite um valor"
            className="h-9 min-w-0 flex-1"
          />
        )
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label="Remover regra"
        className="size-9 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
