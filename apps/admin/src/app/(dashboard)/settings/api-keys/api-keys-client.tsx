"use client";

import { useState, useTransition } from "react";
import { Key, CheckCircle2, XCircle } from "lucide-react";
import { revokeApiKey } from "@/actions/settings";
import { useRouter } from "next/navigation";

type ApiKey = {
  id: string;
  name: string | null;
  key_prefix: string | null;
  is_active: boolean | null;
  created_at: string | null;
  last_used_at: string | null;
};

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKey[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleRevoke = (keyId: string) => {
    startTransition(async () => {
      const result = await revokeApiKey(keyId);
      if (!result.error) {
        setKeys((prev) =>
          prev.map((k) => (k.id === keyId ? { ...k, is_active: false } : k)),
        );
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-foreground">Chaves de API</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Chaves para integração da API de captura de leads do cliente.
        </p>
      </div>

      <div className="border border-border rounded-xl bg-card overflow-hidden">
        {keys.map((key, i) => (
          <div
            key={key.id}
            className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? "border-t border-border/50" : ""}`}
          >
            <div className="size-8 rounded-lg flex items-center justify-center bg-muted shrink-0">
              <Key className="size-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {key.name || "Chave sem nome"}
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                {key.key_prefix ? `${key.key_prefix}...` : "—"}
                {key.last_used_at && (
                  <span className="ml-2 not-italic">
                    · Último uso: {new Date(key.last_used_at).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {key.is_active ? (
                <>
                  <span className="flex items-center gap-1 text-xs text-success">
                    <CheckCircle2 className="size-3.5" />
                    Ativa
                  </span>
                  <button
                    onClick={() => handleRevoke(key.id)}
                    disabled={isPending}
                    className="text-xs text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
                  >
                    Revogar
                  </button>
                </>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <XCircle className="size-3.5" />
                  Revogada
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Para criar novas chaves, o cliente deve acessar o painel do CRM em Configurações → Chaves de API.
      </p>
    </div>
  );
}
