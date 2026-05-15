"use client";

import * as React from "react";
import {
  Plus,
  RefreshCw,
  Loader2,
  Smartphone,
  Wifi,
  WifiOff,
  QrCode,
  Trash2,
  Unplug,
  Link2,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@persia/ui/dialog";

interface Instance {
  id: string;
  token: string;
  name: string;
  status: string;
  profileName: string;
  profilePicUrl: string;
  owner: string;
  isBusiness: boolean;
  qrcode: string;
}

export function InstancesClient() {
  const [instances, setInstances] = React.useState<Instance[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [qrCode, setQrCode] = React.useState<string | null>(null);
  const [qrInstanceToken, setQrInstanceToken] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const loadInstances = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/instances");
      const data = await res.json();
      setInstances(Array.isArray(data) ? data : []);
    } catch {
      setInstances([]);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadInstances();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadInstances]);

  async function createInstance() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();

      if (data.qrCode) {
        setQrCode(data.qrCode);
        setQrInstanceToken(data.token);
        startPolling(data.token);
      }

      setNewName("");
      await loadInstances();
    } catch {}
    setCreating(false);
  }

  async function connectInstance(token: string) {
    setActionLoading(token);
    try {
      const res = await fetch("/api/admin/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect", token }),
      });
      const data = await res.json();

      if (data.qrCode) {
        setQrCode(data.qrCode);
        setQrInstanceToken(token);
        startPolling(token);
      } else if (data.status === "connected") {
        await loadInstances();
      }
    } catch {}
    setActionLoading(null);
  }

  async function disconnectInstance(token: string) {
    setActionLoading(token);
    try {
      await fetch("/api/admin/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect", token }),
      });
      await loadInstances();
    } catch {}
    setActionLoading(null);
  }

  async function deleteInstance(token: string) {
    if (!confirm("Tem certeza que deseja excluir esta instancia?")) return;
    setActionLoading(token);
    try {
      await fetch("/api/admin/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", token }),
      });
      await loadInstances();
    } catch {}
    setActionLoading(null);
  }

  async function setWebhook(token: string) {
    setActionLoading(token);
    try {
      const res = await fetch("/api/admin/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "webhook", token }),
      });
      const data = await res.json();
      if (data.ok) alert("Webhook configurado: " + data.webhookUrl);
    } catch {}
    setActionLoading(null);
  }

  function startPolling(token: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/admin/instances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", token }),
        });
        const data = await res.json();
        if (data.status?.connected && data.status?.loggedIn) {
          setQrCode(null);
          setQrInstanceToken(null);
          if (pollRef.current) clearInterval(pollRef.current);

          // Auto set webhook
          await fetch("/api/admin/instances", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "webhook", token }),
          });

          await loadInstances();
        }
      } catch {}
    }, 3000);

    setTimeout(() => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        setQrCode(null);
      }
    }, 120000);
  }

  function copyToken(token: string) {
    navigator.clipboard.writeText(token);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-6">
      {/* QR Code Modal */}
      {qrCode && (
        <Card className="border-primary">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <QrCode className="size-6 text-primary" />
            <h3 className="font-semibold text-lg">Escaneie o QR Code</h3>
            <div className="p-4 bg-white rounded-2xl shadow-lg">
              <img
                src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code WhatsApp"
                className="w-64 h-64"
              />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Abra o WhatsApp no celular &gt; Menu &gt; Aparelhos conectados &gt; Conectar
            </p>
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Aguardando leitura...</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setQrCode(null); if (pollRef.current) clearInterval(pollRef.current); }}>
              Cancelar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Dialog>
          <DialogTrigger render={<Button><Plus className="size-4" />Nova Instancia</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Nova Instancia</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome da instancia</Label>
                <Input
                  placeholder="Ex: cliente-joao, loja-abc"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <DialogClose render={<Button variant="outline">Cancelar</Button>} />
                <Button onClick={createInstance} disabled={creating || !newName.trim()}>
                  {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Criar e Gerar QR
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Button variant="outline" onClick={loadInstances} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Instances Grid */}
      {loading ? (
        <div className="flex items-center gap-3 py-8">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-muted-foreground">Carregando instancias...</span>
        </div>
      ) : instances.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Smartphone className="size-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium text-lg">Nenhuma instancia</h3>
            <p className="text-sm text-muted-foreground">Clique em &quot;Nova Instancia&quot; para comecar</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {instances.map((inst) => (
            <Card key={inst.id} className={inst.status === "connected" ? "border-success/30" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {inst.profilePicUrl ? (
                      <img src={inst.profilePicUrl} alt="" width={32} height={32} loading="lazy" className="w-8 h-8 rounded-full" />
                    ) : (
                      <Smartphone className="size-5" />
                    )}
                    {inst.name || inst.profileName || "Sem nome"}
                  </CardTitle>
                  <Badge variant={inst.status === "connected" ? "default" : "secondary"}>
                    {inst.status === "connected" ? (
                      <><Wifi className="size-3 mr-1" /> Online</>
                    ) : (
                      <><WifiOff className="size-3 mr-1" /> Offline</>
                    )}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {inst.profileName && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Perfil: </span>
                    <span className="font-medium">{inst.profileName}</span>
                  </div>
                )}
                {inst.owner && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Numero: </span>
                    <span className="font-mono">{inst.owner}</span>
                  </div>
                )}
                {inst.isBusiness && (
                  <Badge variant="outline" className="text-xs">Business</Badge>
                )}

                {/* Token */}
                <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                  <code className="text-xs flex-1 truncate">{inst.token}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => copyToken(inst.token)}
                  >
                    {copied === inst.token ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
                  </Button>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {inst.status === "connected" ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWebhook(inst.token)}
                        disabled={actionLoading === inst.token}
                      >
                        <Link2 className="size-3" />
                        Webhook
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => disconnectInstance(inst.token)}
                        disabled={actionLoading === inst.token}
                      >
                        <Unplug className="size-3" />
                        Desconectar
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => connectInstance(inst.token)}
                      disabled={actionLoading === inst.token}
                    >
                      {actionLoading === inst.token ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <QrCode className="size-3" />
                      )}
                      Conectar
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteInstance(inst.token)}
                    disabled={actionLoading === inst.token}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
