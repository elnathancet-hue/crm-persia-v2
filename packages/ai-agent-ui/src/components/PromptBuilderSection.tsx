"use client";

import * as React from "react";
import { Braces, ChevronDown, Pencil } from "lucide-react";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Button } from "@persia/ui/button";
import { cn } from "@persia/ui/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";

interface Props {
  value: string;
  onChange: (next: string) => void;
  agentId: string;
}

const VARIABLES = [
  { label: "Nome do lead", value: "{{lead.name}}" },
  { label: "Telefone do lead", value: "{{lead.phone}}" },
  { label: "E-mail do lead", value: "{{lead.email}}" },
] as const;

export function PromptBuilderSection({ value, onChange }: Props) {
  const [isEditing, setIsEditing] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  // Ref (não state) pra tracking síncrono do dropdown open — evita
  // colapso acidental pelo onBlur quando o usuário clica em "Variáveis".
  const variablesOpenRef = React.useRef(false);
  const preview = value.trim();
  const charCount = value.length;

  function openEditor() {
    setIsEditing(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  // Auto-colapsa ao sair do container, exceto quando o dropdown de
  // Variáveis estiver aberto (evita fechar o editor ao inserir variável).
  function handleContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (variablesOpenRef.current) return;
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsEditing(false);
  }

  function insertVariable(variable: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? start;
    const newValue = value.slice(0, start) + variable + value.slice(end);
    const newCursor = start + variable.length;
    onChange(newValue);
    // Restaura foco e cursor após React re-renderizar com o novo valor
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    });
  }

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <Label htmlFor="prompt-builder">Instruções</Label>
        <p className="text-xs text-muted-foreground">
          Defina o comportamento do agente, tom de conversa, regras e
          informações importantes.
        </p>
      </div>

      {isEditing ? (
        <div className="space-y-2" onBlur={handleContainerBlur}>
          <div className="relative">
            <Textarea
              ref={textareaRef}
              id="prompt-builder"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              rows={14}
              className="font-mono text-sm pr-32"
              placeholder="Você é um atendente..."
            />
            {/* Botão Variáveis — canto superior direito do textarea */}
            <div className="absolute top-2 right-2">
              <DropdownMenu
                onOpenChange={(open) => {
                  variablesOpenRef.current = open;
                }}
              >
                <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shadow-xs">
                  <Braces className="size-3" />
                  Variáveis
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {VARIABLES.map((v) => (
                    <DropdownMenuItem
                      key={v.value}
                      onClick={() => insertVariable(v.value)}
                    >
                      <span className="flex-1">{v.label}</span>
                      <code className="ml-2 text-xs text-muted-foreground font-mono">
                        {v.value}
                      </code>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
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
