"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getTools } from "@/actions/automations";
import { Wrench, Loader2, ExternalLink } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";

export default function ToolsPage() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const [tools, setTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isManagingClient) { setLoading(false); return; }
    setLoading(true);
    getTools().then((d) => { setTools(d); setLoading(false); });
  }, [activeOrgId]);

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Tools</h1>
        <p className="text-sm text-muted-foreground">Ferramentas de IA disponíveis para {activeOrgName}</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">API de Tools</h2>
        <p className="text-xs text-muted-foreground mb-3">O n8n acessa as tools do CRM via API. Cada tool permite a IA executar ações como mover deals, adicionar tags, etc.</p>
        <div className="bg-muted border border-border rounded-lg p-3 font-mono text-xs text-muted-foreground">
          <p>GET /api/tools?orgId=&#123;org_id&#125;</p>
          <p className="mt-1">POST /api/crm — move_deal, add_tag, remove_tag, pause_bot, get_lead, update_lead</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground/60" /></div>
      ) : tools.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <Wrench className="size-8 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground/60">Nenhuma integração customizada</p>
          <p className="text-xs text-muted-foreground/60 mt-1">As tools padrão (move_deal, add_tag, etc.) estão sempre disponíveis via API</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tools.map((t) => (
            <div key={t.id} className="bg-card border border-border rounded-xl p-4">
              <p className="text-sm text-foreground font-medium">{t.name || t.type}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{t.type}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
