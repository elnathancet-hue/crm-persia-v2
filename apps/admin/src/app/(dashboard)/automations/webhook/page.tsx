"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getWebhookConfigs } from "@/actions/automations";
import { Webhook, Loader2, Copy, Check, ExternalLink } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

export default function WebhookAutomationPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isManagingClient) { setLoading(false); return; }
    setLoading(true);
    getWebhookConfigs().then((d) => { setWebhooks(d); setLoading(false); });
  }, [activeOrgId]);

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Copiado");
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Webhook IA</h1>
        <p className="text-sm text-muted-foreground">Webhooks de automação para {activeOrgName}</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">Endpoint do n8n</h2>
        <p className="text-xs text-muted-foreground mb-3">O CRM envia mensagens para o n8n quando a IA está ativa. O n8n processa e retorna a resposta.</p>
        <div className="bg-muted border border-border rounded-lg p-3 font-mono text-xs text-muted-foreground flex items-center justify-between">
          <span>POST https://n8n.funilpersia.top/webhook/&#123;webhook_id&#125;</span>
          <a href="https://n8n.funilpersia.top" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
            <ExternalLink className="size-4" />
          </a>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : webhooks.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <p className="text-sm text-muted-foreground/60">Nenhum webhook de automação configurado para este cliente</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Configure webhooks em Config → Webhooks</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <div key={wh.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground font-medium">{wh.name}</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">{wh.direction === "inbound" ? "Entrada" : "Saída"} • {wh.is_active ? "Ativo" : "Inativo"}</p>
              </div>
              {wh.token && (
                <button onClick={() => copyToClipboard(wh.token, wh.id)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                  {copiedId === wh.id ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  Token
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
