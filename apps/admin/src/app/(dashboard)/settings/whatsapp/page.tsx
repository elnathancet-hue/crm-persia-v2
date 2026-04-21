"use client";

import { useEffect, useState, useRef } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { useClientStore } from "@/lib/stores/client-store";
import { getWhatsAppStatus } from "@/actions/settings";
import { connectWhatsAppAdmin, getQRCodeAdmin, resetAndGetQRAdmin, disconnectWhatsAppAdmin, autoProvisionWhatsApp } from "@/actions/whatsapp-manage";
import {
  Loader2, RefreshCw, CheckCircle, XCircle, X,
  AlertTriangle, QrCode, Wifi, LogOut, Clock, Link2, Smartphone
} from "lucide-react";
import { toast } from "sonner";
import { NoContextFallback } from "@/components/no-context-fallback";
import { MetaConnectForm } from "@/components/whatsapp/meta-connect-form";

type ProviderTab = "uazapi" | "meta_cloud";

const MAX_QR_POLLS = 60; // 60 polls * 5s = 5 minutes

/** Detects expired/missing admin context errors and clears Zustand state. */
function isContextError(error: string | undefined): boolean {
  if (!error) return false;
  return error.includes("Nenhum contexto ativo") ||
    error.includes("Contexto invalido") ||
    error.includes("Contexto expirado") ||
    error.includes("sessao diferente");
}

export default function WhatsAppPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const clearClient = useClientStore((s) => s.clearClient);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [qrExpired, setQrExpired] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [tab, setTab] = useState<ProviderTab>("uazapi");
  const qrIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const qrPollCountRef = useRef(0);

  function stopPolling() {
    if (qrIntervalRef.current) {
      clearInterval(qrIntervalRef.current);
      qrIntervalRef.current = undefined;
    }
    qrPollCountRef.current = 0;
  }

  /** Handle context expiration: clear Zustand, show message */
  function handleContextExpired() {
    clearClient();
    stopPolling();
    toast.error("Contexto expirado. Selecione o cliente novamente.");
  }

  function loadStatus() {
    if (!isManagingClient) return;
    setLoading(true);
    getWhatsAppStatus()
      .then((data) => {
        setStatus(data);
        setLoading(false);
        if (data.status === "connected") {
          setQrCode(null);
          setQrExpired(false);
          stopPolling();
        }
      })
      .catch(() => {
        setStatus({ status: "unreachable" });
        setLoading(false);
      });
  }

  useEffect(() => {
    loadStatus();
    return () => stopPolling();
  }, [activeOrgId]);

  function startQrPolling() {
    stopPolling();
    qrPollCountRef.current = 0;
    setQrExpired(false);

    qrIntervalRef.current = setInterval(async () => {
      qrPollCountRef.current += 1;

      if (qrPollCountRef.current >= MAX_QR_POLLS) {
        stopPolling();
        setQrExpired(true);
        setQrCode(null);
        toast.warning("QR expirado. Gere um novo QR Code.");
        return;
      }

      try {
        const s = await getWhatsAppStatusCheck();
        if (s === "connected") {
          setQrCode(null);
          setQrExpired(false);
          stopPolling();
          toast.success("WhatsApp conectado!");
          loadStatus();
        }
      } catch {
        // ignore polling errors
      }
    }, 5000);
  }

  async function handleConnect() {
    if (!isManagingClient) return;
    setConnecting(true);
    setQrCode(null);
    setQrExpired(false);
    try {
      // No orgId parameter — reads from signed cookie
      const needsProvision = status?.status === "not_configured" || status?.status === "unreachable";
      const result = needsProvision
        ? await autoProvisionWhatsApp()
        : await connectWhatsAppAdmin();

      if (result.status === "error" && isContextError(result.error)) {
        handleContextExpired();
        setConnecting(false);
        return;
      }

      if (result.status === "connected") {
        toast.success("WhatsApp conectado!");
        loadStatus();
      } else if (result.status === "qr" && result.qrCode) {
        setQrCode(result.qrCode);
        toast.info("Escaneie o QR Code no WhatsApp");
        startQrPolling();
      } else {
        toast.error(result.error || "Erro ao conectar. Tente novamente.");
      }
    } catch {
      toast.error("Erro ao conectar. Tente novamente.");
    }
    setConnecting(false);
  }

  async function handleRefreshQR() {
    if (!isManagingClient) return;
    setQrExpired(false);
    setQrCode(null);
    try {
      // Reset instance session before requesting new QR (clears stale state)
      const result = await resetAndGetQRAdmin();
      if (result.error && isContextError(result.error)) {
        handleContextExpired();
        return;
      }
      if (result.qrCode) {
        setQrCode(result.qrCode);
        startQrPolling();
      } else {
        toast.error("Erro ao gerar QR Code. Tente novamente.");
      }
    } catch {
      toast.error("Erro ao gerar QR Code. Tente novamente.");
    }
  }

  async function handleDisconnect() {
    if (!isManagingClient) return;
    if (!confirm(`Desconectar o WhatsApp de ${activeOrgName}? A IA parara de funcionar.`)) return;
    setDisconnecting(true);
    try {
      const { error } = await disconnectWhatsAppAdmin();
      if (error && isContextError(error)) {
        handleContextExpired();
        setDisconnecting(false);
        return;
      }
      if (error) toast.error("Erro ao desconectar. Tente novamente.");
      else { toast.success("WhatsApp desconectado"); setQrCode(null); setQrExpired(false); stopPolling(); loadStatus(); }
    } catch {
      toast.error("Erro ao desconectar. Tente novamente.");
    }
    setDisconnecting(false);
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>;

  const statusConfig: Record<string, { icon: any; color: string; bg: string; label: string; description: string }> = {
    connected: { icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "WhatsApp Conectado", description: "WhatsApp ativo. IA pode enviar e receber mensagens." },
    disconnected: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10", label: "WhatsApp Desconectado", description: "A instancia existe mas o WhatsApp esta deslogado." },
    unreachable: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", label: "Servidor Indisponivel", description: "Nao foi possivel verificar o status do WhatsApp." },
    not_configured: { icon: Smartphone, color: "text-muted-foreground/60", bg: "bg-card", label: "WhatsApp não configurado", description: "Clique em Conectar WhatsApp para começar. A instância será criada automaticamente." },
  };

  const cfg = statusConfig[status?.status] || statusConfig.not_configured;
  const Icon = cfg.icon;
  const isConnected = status?.status === "connected";
  const isUnreachable = status?.status === "unreachable";

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Provider tabs */}
      <div className="flex gap-1 p-1 bg-card border border-border rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setTab("uazapi")}
          className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
            tab === "uazapi"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Nao-oficial (UAZAPI)
        </button>
        <button
          type="button"
          onClick={() => setTab("meta_cloud")}
          className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
            tab === "meta_cloud"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Oficial (Meta Cloud)
        </button>
      </div>

      {tab === "meta_cloud" && <MetaConnectForm />}

      {tab === "uazapi" && (
      <>
      {/* Status Card */}
      <div className={`${cfg.bg} border border-border rounded-xl p-6`}>
        <div className="flex items-center gap-4">
          <div className={`size-14 rounded-2xl flex items-center justify-center ${cfg.bg} border border-border`}>
            <Icon className={`size-7 ${cfg.color}`} />
          </div>
          <div className="flex-1">
            <h3 className={`text-lg font-semibold ${cfg.color}`}>{cfg.label}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{cfg.description}</p>
          </div>
        </div>

        {/* Phone & instance info (connected or disconnected with data) */}
        {status?.phone && (
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Telefone:</span>
              <span className="text-foreground font-mono">{status.phone}</span>
            </div>
            {status?.instanceUrl && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Instancia:</span>
                <span className="text-foreground text-xs font-mono truncate max-w-[250px]">{status.instanceUrl}</span>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
          {/* Refresh / Retry */}
          <button onClick={loadStatus} className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-xl text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 transition-colors">
            <RefreshCw className="size-4" /> {isUnreachable ? "Tentar Novamente" : "Atualizar Status"}
          </button>

          {/* Edit config button */}
          {status?.status !== "not_configured" && !showConfig && (
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-xl text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 transition-colors">
              <Link2 className="size-4" /> Editar Configuração
            </button>
          )}

          {/* Connect button — works for not_configured, disconnected, AND unreachable (re-provision) */}
          {!isConnected && (
            <button onClick={handleConnect} disabled={connecting} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm disabled:opacity-50 transition-colors">
              {connecting ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />} {isUnreachable ? "Reconectar / Re-provisionar" : status?.status === "not_configured" ? "Conectar WhatsApp" : "Conectar"}
            </button>
          )}

          {/* Disconnect button for connected */}
          {isConnected && (
            <button onClick={handleDisconnect} disabled={disconnecting} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm disabled:opacity-50 transition-colors">
              {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />} Desconectar
            </button>
          )}
        </div>
      </div>

      {/* QR Code Popup — centered overlay */}
      {qrCode && !qrExpired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setQrCode(null); stopPolling(); }} />
          <div className="relative bg-card border border-border rounded-2xl p-6 shadow-2xl max-w-sm w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => { setQrCode(null); stopPolling(); }}
              className="absolute top-3 right-3 size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <QrCode className="size-5 text-primary" />
              <h3 className="text-base font-semibold text-foreground">Escaneie o QR Code</h3>
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
                <li>Abra o <strong className="text-foreground">WhatsApp</strong> no celular</li>
                <li>Menu &gt; <strong className="text-foreground">Dispositivos conectados</strong></li>
                <li>Toque em <strong className="text-foreground">Conectar dispositivo</strong></li>
                <li>Escaneie este QR Code</li>
              </ol>

              <button onClick={handleRefreshQR} className="flex items-center gap-2 px-3 py-1.5 bg-muted border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className="size-3" /> Atualizar QR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advanced config — only shown when manually toggled */}
      {showConfig && status?.instanceUrl && (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Link2 className="size-5 text-primary" />
              <h3 className="text-base font-semibold text-foreground">Configuração Avançada</h3>
            </div>
            <button onClick={() => setShowConfig(false)} className="text-xs text-muted-foreground hover:text-foreground">Fechar</button>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Servidor:</span>
              <span className="text-foreground font-mono text-xs">{status.instanceUrl}</span>
            </div>
          </div>
        </div>
      )}

      {/* QR Expired Popup */}
      {qrExpired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setQrExpired(false)} />
          <div className="relative bg-card border border-border rounded-2xl p-6 shadow-2xl max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setQrExpired(false)}
              className="absolute top-3 right-3 size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="size-14 rounded-2xl flex items-center justify-center bg-amber-500/10 border border-border">
                <Clock className="size-7 text-amber-400" />
              </div>
              <h3 className="text-base font-semibold text-amber-400">QR Expirado</h3>
              <p className="text-sm text-muted-foreground">O tempo para escanear expirou. Gere um novo.</p>
              <button onClick={handleRefreshQR} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm transition-colors">
                <QrCode className="size-4" /> Gerar Novo QR Code
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// Helper to check status inline during polling
async function getWhatsAppStatusCheck(): Promise<string> {
  try {
    const result = await getWhatsAppStatus();
    return result.status;
  } catch {
    return "error";
  }
}
