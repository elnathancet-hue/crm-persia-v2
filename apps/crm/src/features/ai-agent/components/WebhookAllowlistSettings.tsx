"use client";

import * as React from "react";
import { AlertTriangle, Globe, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addAllowedDomain,
  removeAllowedDomain,
} from "@/actions/ai-agent/webhook-allowlist";

interface Props {
  initialDomains: string[];
  onChange?: (next: string[]) => void;
}

export function WebhookAllowlistSettings({ initialDomains, onChange }: Props) {
  const [domains, setDomains] = React.useState(initialDomains);
  const [draft, setDraft] = React.useState("");
  const [isPending, startTransition] = React.useTransition();
  const [pendingDomain, setPendingDomain] = React.useState<string | null>(null);

  const updateDomains = React.useCallback(
    (next: string[]) => {
      setDomains(next);
      onChange?.(next);
    },
    [onChange],
  );

  const handleAdd = (e?: React.FormEvent) => {
    e?.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setPendingDomain(value);
    startTransition(async () => {
      try {
        const next = await addAllowedDomain({ domain: value });
        updateDomains(next);
        setDraft("");
        toast.success(`Domínio adicionado`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao adicionar domínio");
      } finally {
        setPendingDomain(null);
      }
    });
  };

  const handleRemove = (domain: string) => {
    setPendingDomain(domain);
    startTransition(async () => {
      try {
        const next = await removeAllowedDomain(domain);
        updateDomains(next);
        toast.success("Domínio removido");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover domínio");
      } finally {
        setPendingDomain(null);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          Allowlist de webhooks
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ferramentas de webhook customizado só podem chamar hostnames desta lista. URLs HTTPS, porta 443, sem IP literal, sem redirect. Sem allowlist, nenhum webhook externo é aceito.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleAdd} className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="webhook-domain" className="sr-only">
              Domínio
            </Label>
            <Input
              id="webhook-domain"
              placeholder="n8n.sua-empresa.com.br"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={isPending}
            />
          </div>
          <Button type="submit" disabled={isPending || !draft.trim()}>
            {isPending && pendingDomain === draft.trim() ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Adicionar
          </Button>
        </form>

        {domains.length === 0 ? (
          <div className="border border-dashed rounded-md p-4 flex items-start gap-3">
            <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <p className="font-medium">Nenhum domínio cadastrado</p>
              <p className="text-muted-foreground">
                Webhooks customizados ficam indisponíveis ate você adicionar pelo menos um hostname aqui.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {domains.map((domain) => (
              <li
                key={domain}
                className="flex items-center justify-between gap-2 border rounded-md px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-mono truncate">{domain}</span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleRemove(domain)}
                  disabled={isPending && pendingDomain === domain}
                  aria-label={`Remover ${domain}`}
                >
                  {isPending && pendingDomain === domain ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
