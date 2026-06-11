import { requireSuperadminForOrg } from "@/lib/auth";
import { readAdminContext } from "@/lib/admin-context";
import { NoContextFallback } from "@/components/no-context-fallback";
import { listCaptureSourcesAdmin } from "@/actions/settings";
import { notFound } from "next/navigation";
import { Radio, CheckCircle2, XCircle } from "lucide-react";

export const metadata = { title: "Origens de Captura — Configurações" };

export default async function CaptureSourcesPage() {
  const ctxCookie = await readAdminContext();
  if (!ctxCookie) return <NoContextFallback />;

  try {
    await requireSuperadminForOrg();
  } catch {
    notFound();
  }

  const sources = await listCaptureSourcesAdmin();

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-foreground">Origens de Captura</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Fontes configuradas para captura de leads via API embed.
        </p>
      </div>

      {sources.length === 0 ? (
        <div className="border border-border rounded-xl bg-card p-8 text-center">
          <Radio className="size-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma origem de captura configurada.</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          {sources.map(
            (
              source: {
                id: string;
                name: string | null;
                slug: string | null;
                is_active: boolean | null;
                pipeline_id: string | null;
                created_at: string | null;
              },
              i: number,
            ) => (
              <div
                key={source.id}
                className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? "border-t border-border/50" : ""}`}
              >
                <div className="size-8 rounded-lg flex items-center justify-center bg-muted shrink-0">
                  <Radio className="size-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {source.name || "Sem nome"}
                  </p>
                  {source.slug && (
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      /{source.slug}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {source.is_active ? (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="size-3.5" /> Ativa
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <XCircle className="size-3.5" /> Inativa
                    </span>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Para gerenciar origens de captura, o cliente deve acessar o painel do CRM em Configurações → Origens de Captura.
      </p>
    </div>
  );
}
