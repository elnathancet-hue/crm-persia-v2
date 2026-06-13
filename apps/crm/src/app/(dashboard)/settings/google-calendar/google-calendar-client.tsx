"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  ServerCrash,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
import { RelativeTime } from "@persia/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  type GoogleCalendarStatus,
  disconnectGoogleCalendar,
  refreshGoogleCalendarList,
  setGoogleCalendarDefault,
} from "@/actions/google-calendar";

interface Props {
  initialStatus: GoogleCalendarStatus;
}

export function GoogleCalendarSettingsClient({ initialStatus }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = React.useState<GoogleCalendarStatus>(initialStatus);
  const [pending, setPending] = React.useState<"refresh" | "default" | "disconnect" | null>(
    null,
  );
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);

  // Toast pós-callback (?status=ok|error&msg=...)
  React.useEffect(() => {
    const s = searchParams.get("status");
    if (!s) return;
    const msg = searchParams.get("msg");
    if (s === "ok") {
      toast.success("Google Calendar conectado!");
    } else if (s === "error") {
      toast.error(msg || "Falha ao conectar Google Calendar.");
    }
    // Limpa query params da URL sem refresh.
    const url = new URL(window.location.href);
    url.searchParams.delete("status");
    url.searchParams.delete("msg");
    window.history.replaceState({}, "", url.toString());
  }, [searchParams]);

  // Refresh status localmente (pós-action).
  const reload = React.useCallback(() => {
    // Server component refetcha via revalidatePath, mas client precisa
    // forçar router.refresh pra repuxar.
    router.refresh();
  }, [router]);

  function handleConnect() {
    // Server route inicia o OAuth (assina state + redireciona pro Google).
    window.location.href = "/api/oauth/google/connect";
  }

  async function handleRefreshList() {
    setPending("refresh");
    try {
      const res = await refreshGoogleCalendarList();
      if (!res.ok) {
        toast.error(res.error || "Falha ao atualizar lista.");
        return;
      }
      toast.success(`Lista atualizada — ${res.count} calendars.`);
      reload();
    } finally {
      setPending(null);
    }
  }

  async function handleSetDefault(calendarId: string) {
    setPending("default");
    try {
      const res = await setGoogleCalendarDefault(calendarId);
      if (!res.ok) {
        toast.error(res.error || "Falha ao definir calendar padrão.");
        return;
      }
      setStatus((s) => ({ ...s, default_calendar_id: calendarId }));
      toast.success("Calendar padrão definido.");
    } finally {
      setPending(null);
    }
  }

  async function handleDisconnect() {
    setPending("disconnect");
    try {
      const res = await disconnectGoogleCalendar();
      if (!res.ok) {
        toast.error(res.error || "Falha ao desconectar.");
        return;
      }
      setStatus({
        configured: status.configured,
        connected: false,
        account_email: null,
        default_calendar_id: null,
        calendar_list: [],
        connected_at: null,
        last_polled_at: null,
      });
      toast.success("Google Calendar desconectado.");
    } finally {
      setPending(null);
    }
  }

  // ----------------------------------------------------------------
  // Render: not configured (env vars faltando)
  // ----------------------------------------------------------------
  if (!status.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCrash className="size-5 text-destructive" />
            Google Calendar não configurado no servidor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            As variáveis de ambiente do Google OAuth não estão definidas
            no servidor. Pra habilitar a integração:
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              Crie um projeto no{" "}
              <a
                className="underline"
                href="https://console.cloud.google.com"
                target="_blank"
                rel="noreferrer"
              >
                Google Cloud Console
              </a>{" "}
              + habilite a Google Calendar API.
            </li>
            <li>Configure tela de consentimento OAuth (External).</li>
            <li>
              Crie credenciais OAuth Client ID (Web application) com a
              URL de redirect:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {typeof window !== "undefined"
                  ? `${window.location.origin}/api/oauth/google/callback`
                  : "https://<seu-dominio>/api/oauth/google/callback"}
              </code>
            </li>
            <li>
              Defina no EasyPanel as env vars:
              <ul className="list-disc pl-5 pt-1">
                <li>
                  <code className="text-xs">GOOGLE_OAUTH_CLIENT_ID</code>
                </li>
                <li>
                  <code className="text-xs">GOOGLE_OAUTH_CLIENT_SECRET</code>
                </li>
                <li>
                  <code className="text-xs">GOOGLE_OAUTH_REDIRECT_URI</code>
                </li>
              </ul>
            </li>
          </ol>
          {status.error && (
            <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              {status.error}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ----------------------------------------------------------------
  // Render: not connected
  // ----------------------------------------------------------------
  if (!status.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-5" />
            Google Calendar
            <Badge variant="outline" className="ml-auto">
              Não conectado
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Conecte uma conta Google da sua organização pra que a IA crie,
            atualize e cancele agendamentos diretamente no Google Calendar
            quando o lead pedir pelo WhatsApp.
          </p>
          <Button onClick={handleConnect}>
            <ExternalLink className="size-4" />
            Conectar Google Calendar
          </Button>
          {status.error && (
            <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              {status.error}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ----------------------------------------------------------------
  // Render: connected
  // ----------------------------------------------------------------
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-5" />
            Google Calendar
            <Badge variant="success" className="ml-auto gap-1">
              <CheckCircle2 className="size-3" />
              Conectado
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Conta</p>
              <p className="font-medium">{status.account_email}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDisconnect(true)}
              disabled={pending === "disconnect"}
            >
              {pending === "disconnect" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              Desconectar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="size-4" />
            Calendar padrão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Calendar onde a IA cria, atualiza e cancela eventos
            automaticamente quando agenda pelo WhatsApp. Cancel/reschedule
            sincronizam também. Mudanças feitas direto no Google
            (mover/cancelar event) são refletidas no CRM em até 5 minutos
            via cron.
          </p>
          {status.last_polled_at && (
            <p className="text-xs text-muted-foreground">
              Última sincronização Google → CRM:{" "}
              <strong>
                <RelativeTime iso={status.last_polled_at} formatter={(d) => d.toLocaleString("pt-BR")} />
              </strong>
            </p>
          )}
          {status.calendar_list.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Nenhum calendar disponível. Clique em &quot;Atualizar lista&quot;.
            </p>
          ) : (
            <Select
              value={status.default_calendar_id ?? undefined}
              onValueChange={(v) => v && handleSetDefault(v)}
              disabled={pending === "default"}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um calendar" />
              </SelectTrigger>
              <SelectContent>
                {status.calendar_list.map((cal) => (
                  <SelectItem key={cal.id} value={cal.id}>
                    {cal.summary}
                    {cal.primary ? " (principal)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshList}
            disabled={pending === "refresh"}
          >
            {pending === "refresh" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Atualizar lista
          </Button>
        </CardContent>
      </Card>

      {/* Confirm disconnect dialog */}
      <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-sm">
          <DialogHeader className="border-b border-border bg-card p-5">
            <DialogTitle className="sr-only">Desconectar Google Calendar</DialogTitle>
            <DialogHero
              icon={<LogOut className="size-5" />}
              title="Desconectar Google Calendar"
              tagline="Agendamentos automáticos da IA serão pausados até reconectar."
              tone="destructive"
            />
          </DialogHeader>
          <div className="flex justify-end gap-2 border-t border-border p-4">
            <Button variant="outline" onClick={() => setConfirmDisconnect(false)} disabled={pending === "disconnect"}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={pending === "disconnect"}
              onClick={() => { setConfirmDisconnect(false); handleDisconnect(); }}
            >
              {pending === "disconnect" && <Loader2 className="size-4 animate-spin" />}
              Desconectar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
