"use client";

import * as React from "react";
import { CheckCircle2, Copy, Eye, EyeOff, Key, Loader2, Plus, ShieldOff, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@persia/ui/table";
import { createApiKey, revokeApiKey, type ApiKeyRow } from "@/actions/api-keys";

// ============================================================================
// Helpers
// ============================================================================

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

// ============================================================================
// "Created key" dialog — mostra a chave UMA UNICA VEZ
// ============================================================================

function CreatedKeyDialog({
  fullKey,
  onClose,
}: {
  fullKey: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [visible, setVisible] = React.useState(true);

  function copyKey() {
    navigator.clipboard.writeText(fullKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" />
            Chave criada com sucesso
          </DialogTitle>
          <DialogDescription>
            Copie e salve agora — por segurança esta chave{" "}
            <strong>não será exibida novamente</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Warning banner */}
          <div className="flex items-start gap-2 rounded-lg border border-warning-ring bg-warning-soft p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-sm text-warning-soft-foreground">
              Após fechar este diálogo, a chave completa não poderá ser recuperada. Guarde em local seguro.
            </p>
          </div>

          {/* Key display */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Chave de API</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  readOnly
                  name="api_key_display"
                  value={visible ? fullKey : "•".repeat(fullKey.length)}
                  className="font-mono text-sm pr-10"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setVisible((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  aria-label={visible ? "Ocultar chave" : "Mostrar chave"}
                >
                  {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copyKey}
                className="shrink-0"
                aria-label="Copiar chave"
              >
                {copied ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose} className="w-full sm:w-auto">
            {copied ? "Copiei, fechar" : "Fechar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Create key dialog
// ============================================================================

function CreateKeyDialog({
  onCreated,
  onClose,
}: {
  onCreated: (fullKey: string, record: ApiKeyRow) => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const res = await createApiKey(name.trim());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onCreated(res.fullKey, res.record);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Criar chave de API</DialogTitle>
          <DialogDescription>
            A chave será usada para autenticar formulários externos via{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">x-api-key</code>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="key-name">Nome</Label>
            <Input
              id="key-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Site principal, LP Black Friday"
              maxLength={100}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Identifica de onde vêm os leads. Visível só para você.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Criar chave
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Main client
// ============================================================================

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const [keys, setKeys] = React.useState<ApiKeyRow[]>(initialKeys);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);

  function handleCreated(fullKey: string, record: ApiKeyRow) {
    setCreateOpen(false);
    setKeys((prev) => [record, ...prev]);
    setCreatedKey(fullKey);
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`Revogar a chave "${name}"? Formulários que usam ela pararão de funcionar.`)) return;

    setRevoking(id);
    try {
      const res = await revokeApiKey(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, is_active: false } : k)),
      );
      toast.success("Chave revogada.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      {/* Create dialog */}
      {createOpen && (
        <CreateKeyDialog
          onCreated={handleCreated}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {/* Show-once dialog */}
      {createdKey && (
        <CreatedKeyDialog
          fullKey={createdKey}
          onClose={() => setCreatedKey(null)}
        />
      )}

      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Chaves de API autenticam formulários externos que enviam leads para o CRM via{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">POST /api/leads/inbound</code>.
              Cada chave é mostrada apenas uma vez na criação.
            </p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="shrink-0"
            size="sm"
          >
            <Plus className="mr-2 size-4" />
            Criar chave
          </Button>
        </div>

        {/* Table */}
        {keys.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <Key className="size-8 text-muted-foreground/50" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Nenhuma chave criada</p>
                <p className="text-xs text-muted-foreground">
                  Crie uma chave para conectar formulários externos ao CRM.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" />
                Criar primeira chave
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Prefixo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id} className={!key.is_active ? "opacity-50" : undefined}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {key.key_prefix}...
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.is_active ? "default" : "secondary"}>
                        {key.is_active ? "Ativa" : "Revogada"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(key.last_used_at)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(key.created_at)}
                    </TableCell>
                    <TableCell>
                      {key.is_active && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => handleRevoke(key.id, key.name)}
                          disabled={revoking === key.id}
                          aria-label="Revogar chave"
                        >
                          {revoking === key.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <ShieldOff className="size-4" />
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
