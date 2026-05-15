"use client";

import * as React from "react";
import {
  AlertCircle,
  CalendarCheck,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AgentCalendarConnectionPublic,
  CalendarConnectionStatus,
} from "@persia/shared/ai-agent";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { useAgentActions } from "../context";

interface Props {
  /**
   * Lista inicial. Componente faz fetch sozinho se vazia, mas SSR é
   * preferível pra evitar flicker.
   */
  initialConnections?: AgentCalendarConnectionPublic[];
  /**
   * Path pra qual o OAuth callback deve redirecionar depois de
   * conectar. Default: `/automations/agents`.
   */
  returnTo?: string;
}

export function CalendarConnectionsCard({
  initialConnections,
  returnTo = "/automations/agents",
}: Props) {
  const { listCalendarConnections, deleteCalendarConnection, buildOAuthStartUrl } =
    useAgentActions();
  const [connections, setConnections] = React.useState<
    AgentCalendarConnectionPublic[] | null
  >(initialConnections ?? null);
  const [isPending, startTransition] = React.useTransition();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [redirecting, setRedirecting] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const list = await listCalendarConnections();
      setConnections(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, [listCalendarConnections]);

  React.useEffect(() => {
    if (connections === null) void refresh();
  }, [connections, refresh]);

  const handleConnect = () => {
    setRedirecting(true);
    startTransition(async () => {
      try {
        const { url } = await buildOAuthStartUrl(returnTo);
        window.location.href = url;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao iniciar OAuth");
        setRedirecting(false);
      }
    });
  };

  const handleDelete = (conn: AgentCalendarConnectionPublic) => {
    if (
      !window.confirm(
        `Desconectar ${conn.google_account_email}? Agentes que usam essa conexão ficam sem calendário até você atribuir outra.`,
      )
    ) {
      return;
    }
    setDeletingId(conn.id);
    startTransition(async () => {
      try {
        await deleteCalendarConnection(conn.id);
        setConnections((prev) =>
          prev ? prev.filter((c) => c.id !== conn.id) : prev,
        );
        toast.success("Conexão removida");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover");
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarCheck className="size-4 text-primary" />
          Conexões Google Calendar
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Conecte uma ou mais contas Google. Cada agente seleciona qual
          conexão usar pra criar/listar/cancelar eventos no calendário.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {connections === null ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="size-3 animate-spin" />
            Carregando conexões...
          </div>
        ) : connections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 px-4 flex flex-col items-center text-center gap-2">
            <div className="size-10 rounded-xl bg-muted flex items-center justify-center">
              <CalendarCheck className="size-5 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-1">
              <p className="font-semibold text-sm tracking-tight">
                Nenhuma conta Google conectada
              </p>
              <p className="text-xs text-muted-foreground">
                Conecte uma conta Google pra liberar o agente a criar eventos no calendário.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map((conn) => (
              <ConnectionRow
                key={conn.id}
                connection={conn}
                onDelete={() => handleDelete(conn)}
                deleting={deletingId === conn.id}
                disabled={isPending}
              />
            ))}
          </div>
        )}

        <Button
          onClick={handleConnect}
          disabled={isPending || redirecting}
          variant={connections && connections.length > 0 ? "outline" : "default"}
          size="sm"
          className="w-full"
        >
          {redirecting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {connections && connections.length > 0
            ? "Conectar outra conta"
            : "Conectar Google Calendar"}
        </Button>
      </CardContent>
    </Card>
  );
}

interface RowProps {
  connection: AgentCalendarConnectionPublic;
  onDelete: () => void;
  deleting: boolean;
  disabled: boolean;
}

function ConnectionRow({ connection, onDelete, deleting, disabled }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">
            {connection.display_name}
          </p>
          <ConnectionStatusBadge
            status={connection.status}
            error={connection.last_error}
          />
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {connection.google_account_email}
          {connection.google_calendar_id !== "primary" ? (
            <>
              {" · "}
              <span className="font-mono text-[11px]">
                {connection.google_calendar_id}
              </span>
            </>
          ) : null}
        </p>
        {connection.last_error ? (
          <p className="text-xs text-destructive line-clamp-1">
            {connection.last_error}
          </p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-9"
        aria-label="Desconectar"
        onClick={onDelete}
        disabled={disabled}
      >
        {deleting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </Button>
    </div>
  );
}

interface StatusBadgeProps {
  status: CalendarConnectionStatus;
  error: string | null;
}

function ConnectionStatusBadge({ status, error }: StatusBadgeProps) {
  if (status === "active") {
    return (
      <Badge
        variant="outline"
        className="text-xs gap-1 bg-success-soft text-success-soft-foreground border-transparent"
      >
        <CheckCircle2 className="size-3" />
        Ativa
      </Badge>
    );
  }
  if (status === "expired") {
    return (
      <Badge
        variant="outline"
        className="text-xs gap-1 bg-warning-soft text-warning-soft-foreground border-transparent"
        title={error ?? undefined}
      >
        <AlertCircle className="size-3" />
        Expirada
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-xs gap-1 bg-destructive/10 text-destructive border-transparent"
      title={error ?? undefined}
    >
      <AlertCircle className="size-3" />
      Revogada
    </Badge>
  );
}
