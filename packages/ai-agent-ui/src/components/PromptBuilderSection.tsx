"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";

interface Props {
  value: string;
  onChange: (next: string) => void;
  agentId: string;
}

export function PromptBuilderSection({ value, onChange }: Props) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="prompt-builder">Instruções</Label>
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <Info className="size-3.5 shrink-0 mt-0.5" />
          Escreva quem é o agente, o que ele faz, regras, tom de conversa e
          informações importantes. Cada tarefa do fluxo pode adicionar
          instruções específicas por cima.
        </p>
      </div>
      <Textarea
        id="prompt-builder"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={14}
        className="font-mono text-sm"
        placeholder="Você é um atendente..."
      />
    </div>
  );
}
