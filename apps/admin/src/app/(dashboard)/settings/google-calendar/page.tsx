import { requireSuperadminForOrg } from "@/lib/auth";
import { readAdminContext } from "@/lib/admin-context";
import { NoContextFallback } from "@/components/no-context-fallback";
import { getGoogleCalendarStatus } from "@/actions/settings";
import { notFound } from "next/navigation";
import { Calendar, CheckCircle2, XCircle } from "lucide-react";

export const metadata = { title: "Google Agenda — Configurações" };

export default async function GoogleCalendarPage() {
  const ctxCookie = await readAdminContext();
  if (!ctxCookie) return <NoContextFallback />;

  try {
    await requireSuperadminForOrg();
  } catch {
    notFound();
  }

  const connection = await getGoogleCalendarStatus();

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-base font-semibold text-foreground">Google Agenda</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Status da integração com o Google Calendar do cliente.
        </p>
      </div>

      <div className="border border-border rounded-xl bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="size-10 rounded-xl flex items-center justify-center bg-primary/10 shrink-0">
            <Calendar className="size-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            {connection ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  {(connection as { is_active?: boolean }).is_active ? (
                    <CheckCircle2 className="size-4 text-success shrink-0" />
                  ) : (
                    <XCircle className="size-4 text-destructive shrink-0" />
                  )}
                  <span className="font-semibold text-foreground">
                    {(connection as { is_active?: boolean }).is_active ? "Conectado" : "Desconectado"}
                  </span>
                </div>
                {(connection as { email?: string }).email && (
                  <p className="text-sm text-muted-foreground truncate">
                    {(connection as { email?: string }).email}
                  </p>
                )}
                {(connection as { calendar_id?: string }).calendar_id && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    Agenda: {(connection as { calendar_id?: string }).calendar_id}
                  </p>
                )}
                {(connection as { updated_at?: string }).updated_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Atualizado em{" "}
                    {new Date((connection as { updated_at?: string }).updated_at!).toLocaleDateString("pt-BR")}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="size-4 text-muted-foreground shrink-0" />
                  <span className="font-semibold text-foreground">Não configurado</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  O cliente ainda não conectou o Google Calendar.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        A conexão com o Google Calendar só pode ser feita pelo cliente no painel do CRM.
        O admin pode apenas visualizar o status.
      </p>
    </div>
  );
}
