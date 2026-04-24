"use client";

import * as React from "react";
import {
  Smartphone,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  AlertTriangle,
  QrCode,
  LogOut,
  Wifi,
  X,
} from "lucide-react";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { getWhatsAppStatus, connectWhatsApp, getQRCode, disconnectWhatsApp } from "@/actions/whatsapp-status";
import { toast } from "sonner";

type Status = "loading" | "not_configured" | "connected" | "disconnected" | "unreachable";

const MAX_QR_RETRIES = 60; // 60 x 5s = 5 minutes

export function WhatsAppSettingsClient() {
  const [status, setStatus] = React.useState<Status>("loading");
  const [phoneNumber, setPhoneNumber] = React.useState<string | null>(null);
  const [qrCode, setQrCode] = React.useState<string | null>(null);
  const [qrExpired, setQrExpired] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const qrIntervalRef = React.useRef<ReturnType<typeof setInterval>>(undefined);
  const qrRetryCountRef = React.useRef(0);

  const stopPolling = React.useCallback(() => {
    if (qrIntervalRef.current) {
      clearInterval(qrIntervalRef.current);
      qrIntervalRef.current = undefined;
    }
    qrRetryCountRef.current = 0;
  }, []);

  const checkStatus = React.useCallback(async () => {
    setStatus("loading");
    try {
      const result = await getWhatsAppStatus();
      setStatus(result.status);
      setPhoneNumber(result.phoneNumber);
      if (result.status === "connected") {
        setQrCode(null);
        setQrExpired(false);
        stopPolling();
      }
    } catch {
      setStatus("not_configured");
    }
  }, [stopPolling]);

  React.useEffect(() => {
    checkStatus();
    return () => stopPolling();
  }, [checkStatus, stopPolling]);

  function startQrPolling() {
    stopPolling();
    qrRetryCountRef.current = 0;
    setQrExpired(false);

    qrIntervalRef.current = setInterval(async () => {
      qrRetryCountRef.current += 1;

      if (qrRetryCountRef.current >= MAX_QR_RETRIES) {
        stopPolling();
        setQrExpired(true);
        setQrCode(null);
        toast.error("QR Code expirado. Gere um novo para conectar.");
        return;
      }

      try {
        const s = await getWhatsAppStatus();
        if (s.status === "connected") {
          setQrCode(null);
          setQrExpired(false);
          setStatus("connected");
          setPhoneNumber(s.phoneNumber);
          toast.success("WhatsApp conectado!");
          stopPolling();
        }
      } catch {
        // Silently continue polling
      }
    }, 5000);
  }

  async function handleConnect() {
    setConnecting(true);
    setQrCode(null);
    setQrExpired(false);
    try {
      const result = await connectWhatsApp();
      if (result.status === "connected") {
        toast.success("WhatsApp conectado!");
        setQrCode(null);
        checkStatus();
      } else if (result.status === "qr" && result.qrCode) {
        setQrCode(result.qrCode);
        toast.info("Escaneie o QR Code no WhatsApp");
        startQrPolling();
      } else {
        toast.error("Erro ao conectar. Verifique sua conexao e tente novamente.");
      }
    } catch {
      toast.error("Erro ao conectar. Verifique sua conexao e tente novamente.");
    }
    setConnecting(false);
  }

  async function handleRefreshQR() {
    setQrExpired(false);
    try {
      const result = await getQRCode();
      if (result.qrCode) {
        setQrCode(result.qrCode);
        startQrPolling();
      } else {
        toast.error("Nao foi possivel gerar o QR Code. Tente novamente.");
      }
    } catch {
      toast.error("Erro ao gerar QR Code. Tente novamente.");
    }
  }

  async function handleDisconnect() {
    if (!confirm("Tem certeza que deseja desconectar o WhatsApp? A IA parara de funcionar.")) return;
    setDisconnecting(true);
    try {
      const { error } = await disconnectWhatsApp();
      if (error) {
        toast.error("Erro ao desconectar. Tente novamente.");
      } else {
        toast.success("WhatsApp desconectado");
        setQrCode(null);
        setQrExpired(false);
        checkStatus();
      }
    } catch {
      toast.error("Erro ao desconectar. Tente novamente.");
    }
    setDisconnecting(false);
  }

  const isConnected = status === "connected";

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone className="size-4" />
            Status da Conexao
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" ? (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="size-5 animate-spin text-primary" />
              <span className="text-muted-foreground">Verificando conexao...</span>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className={`size-14 rounded-full flex items-center justify-center ${
                isConnected ? "bg-green-100 dark:bg-green-900/30"
                  : status === "unreachable" ? "bg-amber-100 dark:bg-amber-900/30"
                  : "bg-muted"
              }`}>
                {isConnected ? <CheckCircle2 className="size-7 text-green-600" />
                  : status === "unreachable" ? <AlertTriangle className="size-7 text-amber-600" />
                  : <XCircle className="size-7 text-muted-foreground" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">
                    {isConnected ? "WhatsApp Conectado"
                      : status === "unreachable" ? "Nao foi possivel verificar o status"
                      : status === "not_configured" ? "WhatsApp nao configurado"
                      : "WhatsApp Desconectado"}
                  </h3>
                  <Badge variant={isConnected ? "default" : status === "unreachable" ? "outline" : "secondary"}>
                    {isConnected ? "Online" : status === "unreachable" ? "Indisponivel" : "Inativo"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isConnected ? "WhatsApp ativo. A IA pode enviar e receber mensagens."
                    : status === "not_configured" ? "Clique em Conectar WhatsApp para configurar. A instancia sera criada automaticamente."
                    : status === "unreachable" ? "Nao foi possivel verificar o status. Tente novamente."
                    : "WhatsApp desconectado. Clique em Conectar para escanear o QR Code."}
                </p>
              </div>
            </div>
          )}

          {isConnected && phoneNumber && (
            <div className="p-3 rounded-lg bg-muted/50 border">
              <p className="text-xs text-muted-foreground">Numero conectado</p>
              <p className="font-mono font-medium text-lg">{phoneNumber}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={checkStatus}>
              <RefreshCw className="size-4" />
              Atualizar status
            </Button>

            {!isConnected && (
              <Button size="sm" onClick={handleConnect} disabled={connecting}>
                {connecting ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />}
                Conectar WhatsApp
              </Button>
            )}

            {isConnected && (
              <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                Desconectar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* QR Code Popup — centered overlay */}
      {qrCode && !qrExpired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setQrCode(null); stopPolling(); }} />
          <div className="relative bg-card border rounded-2xl p-6 shadow-2xl max-w-sm w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => { setQrCode(null); stopPolling(); }}
              className="absolute top-3 right-3 size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <QrCode className="size-5 text-primary" />
              <h3 className="text-base font-semibold">Escaneie o QR Code</h3>
            </div>

            <div className="flex flex-col items-center gap-3">
              <div className="bg-white p-3 rounded-xl">
                <img
                  src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                  alt="QR Code WhatsApp"
                  className="w-56 h-56"
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Aguardando leitura...
              </div>

              <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside w-full">
                <li>Abra o <strong>WhatsApp</strong> no celular</li>
                <li>Menu &gt; <strong>Dispositivos conectados</strong></li>
                <li>Toque em <strong>Conectar dispositivo</strong></li>
                <li>Escaneie este QR Code</li>
              </ol>

              <Button variant="outline" size="sm" onClick={handleRefreshQR}>
                <RefreshCw className="size-4" />
                Atualizar QR
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* QR Expired Popup */}
      {qrExpired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setQrExpired(false)} />
          <div className="relative bg-card border rounded-2xl p-6 shadow-2xl max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setQrExpired(false)}
              className="absolute top-3 right-3 size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="size-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <AlertTriangle className="size-8 text-amber-600" />
              </div>
              <p className="text-sm font-medium">QR Code expirado</p>
              <p className="text-xs text-muted-foreground">O tempo expirou. Gere um novo.</p>
              <Button onClick={handleRefreshQR}>
                <QrCode className="size-4" />
                Gerar novo QR Code
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
