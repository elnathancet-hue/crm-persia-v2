"use client";

import { Fragment, useState, useTransition, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, Filter, X } from "lucide-react";
import type { AuditLogRow } from "@/actions/admin";

interface Filters {
  action: string;
  orgId: string;
  result: string;
  since: string;
  until: string;
}

interface Props {
  initialRows: AuditLogRow[];
  initialTotal: number;
  initialOffset: number;
  initialFilters: Filters;
  actions: string[];
  orgs: Array<{ id: string; name: string }>;
}

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  switch_context: "Trocar contexto",
  clear_context: "Limpar contexto",
  create_organization: "Criar organizacao",
  update_organization: "Atualizar organizacao",
  delete_organization: "Excluir organizacao",
  send_message: "Enviar mensagem",
  update_whatsapp: "Atualizar WhatsApp",
  disconnect_whatsapp: "Desconectar WhatsApp",
  whatsapp_provision: "Provisionar WhatsApp",
  whatsapp_disconnect: "Desconectar WhatsApp",
  whatsapp_connect_meta: "Conectar Meta Cloud",
  execute_campaign: "Executar campanha",
  schedule_campaign: "Agendar campanha",
  update_org_settings: "Atualizar organizacao",
  create_team_member: "Criar membro",
  update_member_role: "Atualizar permissao",
  toggle_member_active: "Ativar/desativar membro",
  add_superadmin: "Adicionar superadmin",
  remove_superadmin: "Remover superadmin",
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] || action;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatResult(result: string | null): string {
  if (result === "failure") return "Falha";
  if (result === "partial") return "Parcial";
  return "Sucesso";
}

function resultBadgeClass(result: string | null): string {
  if (result === "failure") return "bg-destructive/10 text-destructive";
  if (result === "partial") return "bg-amber-500/10 text-amber-700";
  return "bg-emerald-500/10 text-emerald-700";
}

function toUtcIso(localDt: string): string {
  if (!localDt) return "";
  try { return new Date(localDt).toISOString(); } catch { return localDt; }
}

function toLocalDt(utcIso: string): string {
  if (!utcIso) return "";
  try {
    const d = new Date(utcIso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  } catch { return utcIso; }
}

function buildQuery(filters: Filters, offset: number): string {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.orgId) params.set("org", filters.orgId);
  if (filters.result) params.set("result", filters.result);
  if (filters.since) params.set("since", toUtcIso(filters.since));
  if (filters.until) params.set("until", toUtcIso(filters.until));
  if (offset > 0) params.set("offset", String(offset));
  return params.toString();
}

export function AuditClient({
  initialRows,
  initialTotal,
  initialOffset,
  initialFilters,
  actions,
  orgs,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState<Filters>({
    ...initialFilters,
    since: toLocalDt(initialFilters.since),
    until: toLocalDt(initialFilters.until),
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const hasFilters = useMemo(
    () => !!(filters.action || filters.orgId || filters.result || filters.since || filters.until),
    [filters]
  );

  function navigate(nextFilters: Filters, offset: number) {
    const qs = buildQuery(nextFilters, offset);
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function applyFilters() {
    navigate(filters, 0);
  }

  function clearFilters() {
    const empty: Filters = { action: "", orgId: "", result: "", since: "", until: "" };
    setFilters(empty);
    navigate(empty, 0);
  }

  const totalPages = Math.max(1, Math.ceil(initialTotal / PAGE_SIZE));
  const currentPage = Math.floor(initialOffset / PAGE_SIZE) + 1;
  const hasPrev = initialOffset > 0;
  const hasNext = initialOffset + PAGE_SIZE < initialTotal;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="size-4" />
          Filtros
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="size-3" /> Limpar
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Acao</label>
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="">Todas</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {formatAction(a)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Organizacao</label>
            <select
              value={filters.orgId}
              onChange={(e) => setFilters({ ...filters, orgId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="">Todas</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Resultado</label>
            <select
              value={filters.result}
              onChange={(e) => setFilters({ ...filters, result: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="">Todos</option>
              <option value="success">Sucesso</option>
              <option value="failure">Falha</option>
              <option value="partial">Parcial</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">De</label>
            <input
              type="datetime-local"
              value={filters.since}
              onChange={(e) => setFilters({ ...filters, since: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Ate</label>
            <input
              type="datetime-local"
              value={filters.until}
              onChange={(e) => setFilters({ ...filters, until: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={applyFilters}
            disabled={isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Aplicando..." : "Aplicar"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">
            {initialTotal.toLocaleString("pt-BR")} registro{initialTotal === 1 ? "" : "s"}
          </span>
          <span className="text-xs text-muted-foreground">
            Pagina {currentPage} de {totalPages}
          </span>
        </div>

        {initialRows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            Nenhum registro encontrado
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium w-8"></th>
                  <th className="px-4 py-2 font-medium">Quando</th>
                  <th className="px-4 py-2 font-medium">Usuario</th>
                  <th className="px-4 py-2 font-medium">Acao</th>
                  <th className="px-4 py-2 font-medium">Resultado</th>
                  <th className="px-4 py-2 font-medium">Organizacao</th>
                  <th className="px-4 py-2 font-medium">Entidade</th>
                </tr>
              </thead>
              <tbody>
                {initialRows.map((row) => {
                  const isExpanded = expanded === row.id;
                  const hasDetails = Object.keys(row.metadata).length > 0 || !!row.error_msg || !!row.request_id || !!row.ip || !!row.user_agent;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className="border-b border-border hover:bg-muted/20 cursor-pointer"
                        onClick={() => setExpanded(isExpanded ? null : row.id)}
                      >
                        <td className="px-4 py-2 text-muted-foreground">
                          {hasDetails ? (
                            isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap">{formatDate(row.created_at)}</td>
                        <td className="px-4 py-2">
                          <div className="font-medium">{row.user_name || "Sem nome"}</div>
                          <div className="text-xs text-muted-foreground">{row.user_email}</div>
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-block px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium">
                            {formatAction(row.action)}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${resultBadgeClass(row.result)}`}>
                            {formatResult(row.result)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {row.target_org_name || <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {row.entity_type ? (
                            <>
                              {row.entity_type}
                              {row.entity_id && <span className="opacity-60"> · {row.entity_id.slice(0, 8)}</span>}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                      {isExpanded && hasDetails && (
                        <tr className="border-b border-border bg-muted/10">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="rounded-lg border border-border bg-background p-3 text-xs">
                                <div className="font-medium mb-2">Rastreamento</div>
                                <dl className="space-y-1 text-muted-foreground">
                                  <div><dt className="inline text-foreground">Request ID: </dt><dd className="inline break-all">{row.request_id || "-"}</dd></div>
                                  <div><dt className="inline text-foreground">IP: </dt><dd className="inline break-all">{row.ip || "-"}</dd></div>
                                  <div><dt className="inline text-foreground">User agent: </dt><dd className="inline break-all">{row.user_agent || "-"}</dd></div>
                                </dl>
                              </div>
                              <div className="rounded-lg border border-border bg-background p-3 text-xs">
                                <div className="font-medium mb-2">Erro</div>
                                <p className="text-muted-foreground whitespace-pre-wrap break-words">{row.error_msg || "-"}</p>
                              </div>
                            </div>
                            {Object.keys(row.metadata).length > 0 && (
                              <pre className="mt-3 text-xs bg-background p-3 rounded-lg overflow-x-auto border border-border">
                                {JSON.stringify(row.metadata, null, 2)}
                              </pre>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={!hasPrev || isPending}
            onClick={() => navigate(filters, Math.max(0, initialOffset - PAGE_SIZE))}
            className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40 hover:bg-muted"
          >
            Anterior
          </button>
          <span className="text-sm text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={!hasNext || isPending}
            onClick={() => navigate(filters, initialOffset + PAGE_SIZE)}
            className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40 hover:bg-muted"
          >
            Proxima
          </button>
        </div>
      )}
    </div>
  );
}
