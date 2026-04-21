"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useActiveOrg } from "@/lib/stores/client-store";
import { listTemplates, syncTemplates, type TemplateRow } from "@/actions/templates";
import { NoContextFallback } from "@/components/no-context-fallback";

type StatusFilter = "ALL" | "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED";
type CategoryFilter = "ALL" | "MARKETING" | "UTILITY" | "AUTHENTICATION";

const STATUS_LABEL: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Em analise",
  REJECTED: "Rejeitado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
};

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "text-emerald-400 bg-emerald-500/10",
  PENDING: "text-amber-400 bg-amber-500/10",
  REJECTED: "text-red-400 bg-red-500/10",
  PAUSED: "text-muted-foreground bg-card",
  DISABLED: "text-muted-foreground bg-card",
};

export default function TemplatesPage() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [search, setSearch] = useState("");

  function load() {
    if (!isManagingClient) return;
    setLoading(true);
    listTemplates({})
      .then((data) => setRows(data))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  async function handleSync() {
    if (!isManagingClient) return;
    setSyncing(true);
    try {
      const r = await syncTemplates();
      if (r.ok) {
        toast.success(`${r.synced ?? 0} templates sincronizados`);
        load();
      } else {
        toast.error(r.error || "Erro ao sincronizar");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (status !== "ALL" && r.status !== status) return false;
      if (category !== "ALL" && r.category !== category) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, status, category, search]);

  if (!isManagingClient) return <NoContextFallback />;

  const lastSync = rows.length > 0
    ? new Date(Math.max(...rows.map((r) => new Date(r.last_synced_at).getTime())))
    : null;

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-2xl flex items-center justify-center bg-primary/10 border border-border">
            <FileText className="size-6 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">Templates WhatsApp</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Templates aprovados pela Meta para enviar fora da janela de 24h.
              Sincronizados a partir da conexao Meta Cloud conectada.
            </p>
            {lastSync && (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                <Clock className="size-3" /> Ultima sincronizacao:{" "}
                {lastSync.toLocaleString("pt-BR")}
              </p>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm disabled:opacity-50 transition-colors shrink-0"
          >
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Sincronizar agora
          </button>
        </div>
      </div>

      {/* Info: onde criar templates */}
      <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
        <AlertCircle className="size-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground">
          Templates sao criados e aprovados pela Meta em{" "}
          <a
            href="https://business.facebook.com/wa/manage/message-templates/"
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            business.facebook.com <ExternalLink className="size-3" />
          </a>
          . Apos criar, clique em <strong className="text-foreground">Sincronizar agora</strong> para trazer para ca.
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome..."
            className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="ALL">Todos status</option>
          <option value="APPROVED">Aprovados</option>
          <option value="PENDING">Em analise</option>
          <option value="REJECTED">Rejeitados</option>
          <option value="PAUSED">Pausados</option>
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryFilter)}
          className="px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="ALL">Todas categorias</option>
          <option value="MARKETING">Marketing</option>
          <option value="UTILITY">Utilidade</option>
          <option value="AUTHENTICATION">Autenticacao</option>
        </select>

        <div className="flex items-center gap-1 px-3 py-2 bg-card border border-border rounded-lg text-xs text-muted-foreground">
          <Filter className="size-3" />
          {filtered.length} / {rows.length}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <FileText className="size-12 mx-auto text-muted-foreground/40 mb-3" />
          <h3 className="text-base font-semibold text-foreground mb-1">Nenhum template ainda</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Clique em <strong>Sincronizar agora</strong> para trazer os templates aprovados da Meta.
          </p>
          <p className="text-xs text-muted-foreground">
            Precisa ter uma conexao Meta Cloud ativa em Configuracoes &gt; WhatsApp &gt; aba Oficial.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          Nenhum template corresponde aos filtros.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((t) => (
            <TemplateCard key={t.id} row={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ row }: { row: TemplateRow }) {
  const body = useMemo(() => {
    const comps = (row.components ?? []) as Array<{ type: string; text?: string }>;
    return comps.find((c) => c.type === "BODY")?.text ?? "";
  }, [row.components]);

  const statusClass = STATUS_COLOR[row.status] ?? "text-muted-foreground bg-card";
  const statusLabel = STATUS_LABEL[row.status] ?? row.status;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground font-mono">{row.name}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{row.language}</span>
            <span>•</span>
            <span>{row.category}</span>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-md text-xs font-medium inline-flex items-center gap-1 ${statusClass}`}>
          {row.status === "APPROVED" && <CheckCircle2 className="size-3" />}
          {statusLabel}
        </span>
      </div>

      {body && (
        <p className="text-sm text-foreground/80 whitespace-pre-wrap mt-3 border-t border-border pt-3">
          {body}
        </p>
      )}
    </div>
  );
}
