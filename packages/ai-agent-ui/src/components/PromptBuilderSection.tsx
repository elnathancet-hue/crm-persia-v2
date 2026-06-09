"use client";

import * as React from "react";
import { ChevronDown, Info, Pencil } from "lucide-react";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Button } from "@persia/ui/button";
import { cn } from "@persia/ui/utils";

interface Props {
  value: string;
  onChange: (next: string) => void;
  agentId: string;
}

export function PromptBuilderSection({ value, onChange }: Props) {
  const [isEditing, setIsEditing] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const preview = value.trim();
  const charCount = value.length;

  function openEditor() {
    setIsEditing(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="prompt-builder">Instruções</Label>
        {!isEditing && (
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="size-3.5 shrink-0 mt-0.5" />
            Escreva quem é o agente, o que ele faz, regras, tom de conversa e
            informações importantes.
          </p>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            id="prompt-builder"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={14}
            className="font-mono text-sm"
            placeholder="Você é um atendente..."
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground tabular-nums">
              {charCount > 0 ? `${charCount.toLocaleString("pt-BR")} caracteres` : ""}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground gap-1 hover:text-foreground"
              onClick={() => setIsEditing(false)}
            >
              <ChevronDown className="size-3.5" />
              Fechar
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openEditor}
          className={cn(
            "w-full text-left rounded-lg border border-border bg-background px-3 py-2.5",
            "hover:border-primary/50 hover:bg-muted/20 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "group",
          )}
        >
          {preview ? (
            <p className="text-sm font-mono text-foreground/75 line-clamp-3 leading-relaxed whitespace-pre-line">
              {preview}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Clique para adicionar as instruções do agente...
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground group-hover:text-primary transition-colors">
            <Pencil className="size-3" />
            {preview
              ? `Editar instruções · ${charCount.toLocaleString("pt-BR")} caracteres`
              : "Adicionar instruções"}
          </div>
        </button>
      )}
    </div>
  );
}
