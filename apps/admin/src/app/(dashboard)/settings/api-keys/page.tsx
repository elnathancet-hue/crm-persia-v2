import { requireSuperadminForOrg } from "@/lib/auth";
import { readAdminContext } from "@/lib/admin-context";
import { NoContextFallback } from "@/components/no-context-fallback";
import { listApiKeys } from "@/actions/settings";
import { notFound } from "next/navigation";
import { Key } from "lucide-react";
import { ApiKeysClient } from "./api-keys-client";

export const metadata = { title: "Chaves de API — Configurações" };

export default async function ApiKeysPage() {
  const ctxCookie = await readAdminContext();
  if (!ctxCookie) return <NoContextFallback />;

  try {
    await requireSuperadminForOrg();
  } catch {
    notFound();
  }

  const keys = await listApiKeys();

  if (keys.length === 0) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div>
          <h2 className="text-base font-semibold text-foreground">Chaves de API</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Chaves para integração da API de captura de leads.
          </p>
        </div>
        <div className="border border-border rounded-xl bg-card p-8 text-center">
          <Key className="size-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma chave de API criada ainda.</p>
        </div>
      </div>
    );
  }

  return <ApiKeysClient initialKeys={keys} />;
}
