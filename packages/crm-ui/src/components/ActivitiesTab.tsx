"use client";

// PR-V1c (movido de apps/crm/src/components/crm/activities-tab.tsx):
// timeline cronologica global de activities da org.
//
// Renderiza dentro do shell de /crm na tab "Atividades". Antes vivia
// no CRM cliente; movido pra @persia/crm-ui pra o admin tambem
// consumir (5a tab no AdminCrmShell).
//
// Estrutura:
//   - Filtros chips no topo (Todos / Mensagens / Tags / Mudancas / Sistema)
//   - Lista vertical com avatar do tipo + descricao + lead clicavel
//     + horario relativo
//   - Botao "Carregar mais" no fim (pagina + 30)
//   - Empty state quando vazio
//
// DI: a action server-side e injetada via prop `listActivities`. Cada
// app injeta a sua (CRM = requireRole agent; admin = requireSuperadminForOrg).
// Mesma assinatura: (options) => Promise<OrgActivitiesResult>.
//
// Os tipos do schema atual (lead_activities.type) sao tecnicos:
//   created, edited, tag_added, tag_removed, message_sent,
//   message_received, assigned, status_changed, score_changed,
//   merged, imported, flow_entered, flow_exited.
// Agrupamos em 4 categorias amigaveis pro filtro.

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Filter,
  Loader2,
  MessageCircle,
  RefreshCw,
  Tag as TagIcon,
  Tags,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";
import type { OrgActivityRow } from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import { EmptyState } from "@persia/ui/empty-state";
import { RelativeTime, formatRelativeShortPtBR } from "@persia/ui";

/** Resultado paginado vindo do server action. Mesma shape do
 *  ListOrgActivitiesOptions/OrgActivitiesResult do @persia/shared/crm,
 *  reexpresso aqui pra evitar dependencia transitiva no caller. */
export interface ActivitiesPage {
  activities: OrgActivityRow[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ListActivitiesOptions {
  page?: number;
  limit?: number;
  types?: string[];
  leadId?: string;
}

export type ListActivitiesFn = (
  options: ListActivitiesOptions,
) => Promise<ActivitiesPage>;

export interface ActivitiesTabProps {
  initialActivities: OrgActivityRow[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  /** DI: action server-side que devolve uma pagina filtrada/paginada.
   *  CRM passa wrapper de requireRole("agent"); admin passa wrapper de
   *  requireSuperadminForOrg(). */
  listActivities: ListActivitiesFn;
  /** Link pra detalhe do lead. Default `/leads/{id}` — admin pode passar
   *  `/leads?leadId={id}` se quiser usar drawer no lugar. */
  leadHref?: (leadId: string) => string;
}

// Filtros agrupados — mapeia categoria visivel -> lista de tipos do schema
type FilterKey = "all" | "messages" | "tags" | "changes" | "system";

const FILTERS: {
  key: FilterKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  types: string[];
}[] = [
  { key: "all", label: "Todos", icon: Activity, types: [] },
  {
    key: "messages",
    label: "Mensagens",
    icon: MessageCircle,
    types: ["message_sent", "message_received"],
  },
  {
    key: "tags",
    label: "Tags",
    icon: TagIcon,
    types: ["tag_added", "tag_removed"],
  },
  {
    key: "changes",
    label: "Mudanças",
    // PR-B2: incluido `stage_change` no filter (deal movido entre etapas
    // do funil) — antes ficava fora de qualquer categoria e nao aparecia
    // ao filtrar por "Mudanças".
    icon: UserCog,
    types: [
      "assigned",
      "status_changed",
      "score_changed",
      "stage_change",
    ],
  },
  {
    key: "system",
    label: "Sistema",
    icon: RefreshCw,
    types: [
      "created",
      "edited",
      "imported",
      "merged",
      "flow_entered",
      "flow_exited",
    ],
  },
];

const PAGE_SIZE = 30;

// Mapeia tipo -> descricao default + cor + icone (pra quando description=null)
//
// PR-COLOR-SWEEP (mai/2026): cores migradas de hardcode emerald/blue/violet/
// amber/pink/cyan/indigo pros tokens semanticos do DS. Mapeamento intencional
// por tipo de evento:
//   - eventos POSITIVOS (criado, mensagem enviada) → success
//   - eventos INFORMATIVOS (importado, mensagem recebida) → primary
//   - eventos EM-FLUXO (merged, assigned, stage_change) → progress
//   - eventos de ATENCAO (status alterado) → warning
//   - eventos NEUTROS (edited, score_changed, tags) → chart-N pra variedade
const TYPE_META: Record<
  string,
  { label: string; tone: string; iconBg: string }
> = {
  created: {
    label: "Lead cadastrado",
    tone: "text-success",
    iconBg: "bg-success-soft text-success",
  },
  edited: {
    label: "Lead atualizado",
    tone: "text-foreground",
    iconBg: "bg-muted text-muted-foreground",
  },
  imported: {
    label: "Lead importado",
    tone: "text-primary",
    iconBg: "bg-primary/10 text-primary",
  },
  merged: {
    label: "Lead mesclado",
    tone: "text-progress",
    iconBg: "bg-progress-soft text-progress",
  },
  tag_added: {
    label: "Tag adicionada",
    tone: "text-chart-2",
    iconBg: "bg-chart-2/15 text-chart-2",
  },
  tag_removed: {
    label: "Tag removida",
    tone: "text-muted-foreground",
    iconBg: "bg-muted text-muted-foreground",
  },
  message_sent: {
    label: "Mensagem enviada",
    tone: "text-success",
    iconBg: "bg-success-soft text-success",
  },
  message_received: {
    label: "Mensagem recebida",
    tone: "text-primary",
    iconBg: "bg-primary/10 text-primary",
  },
  assigned: {
    label: "Responsável atribuído",
    tone: "text-progress",
    iconBg: "bg-progress-soft text-progress",
  },
  status_changed: {
    label: "Status alterado",
    tone: "text-warning",
    iconBg: "bg-warning-soft text-warning",
  },
  score_changed: {
    label: "Score atualizado",
    tone: "text-chart-5",
    iconBg: "bg-chart-5/15 text-chart-5",
  },
  // PR-B2: deal movido entre etapas do funil. Antes ficava sem entry e
  // o fallback mostrava o type cru ("stage_change") na timeline.
  stage_change: {
    label: "Etapa do funil alterada",
    tone: "text-progress",
    iconBg: "bg-progress-soft text-progress",
  },
  flow_entered: {
    label: "Entrou no fluxo",
    tone: "text-foreground",
    iconBg: "bg-muted text-muted-foreground",
  },
  flow_exited: {
    label: "Saiu do fluxo",
    tone: "text-foreground",
    iconBg: "bg-muted text-muted-foreground",
  },
};

function getTypeMeta(type: string) {
  return (
    TYPE_META[type] ?? {
      label: type,
      tone: "text-foreground",
      iconBg: "bg-muted text-muted-foreground",
    }
  );
}

// Sprint 3c: formatRelative local removido. Usa
// <RelativeTime formatter={formatRelativeShortPtBR} /> do @persia/ui
// pra evitar React #418 (hydration mismatch).

export function ActivitiesTab({
  initialActivities,
  initialTotal,
  initialPage,
  initialTotalPages,
  listActivities,
  leadHref = (id) => `/leads/${id}`,
}: ActivitiesTabProps) {
  const [activities, setActivities] = React.useState<OrgActivityRow[]>(
    initialActivities,
  );
  const [total, setTotal] = React.useState(initialTotal);
  const [page, setPage] = React.useState(initialPage);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);
  const [activeFilter, setActiveFilter] = React.useState<FilterKey>("all");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isAppending, setIsAppending] = React.useState(false);

  // Sync com server revalidation
  React.useEffect(() => {
    setActivities(initialActivities);
    setTotal(initialTotal);
    setPage(initialPage);
    setTotalPages(initialTotalPages);
  }, [initialActivities, initialTotal, initialPage, initialTotalPages]);

  const applyFilter = async (key: FilterKey) => {
    setActiveFilter(key);
    setIsLoading(true);
    try {
      const filter = FILTERS.find((f) => f.key === key)!;
      const result = await listActivities({
        page: 1,
        limit: PAGE_SIZE,
        types: filter.types.length > 0 ? filter.types : undefined,
      });
      setActivities(result.activities);
      setTotal(result.total);
      setPage(result.page);
      setTotalPages(result.totalPages);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao carregar atividades",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (page >= totalPages || isAppending) return;
    setIsAppending(true);
    try {
      const filter = FILTERS.find((f) => f.key === activeFilter)!;
      const next = page + 1;
      const result = await listActivities({
        page: next,
        limit: PAGE_SIZE,
        types: filter.types.length > 0 ? filter.types : undefined,
      });
      setActivities((prev) => [...prev, ...result.activities]);
      setPage(result.page);
      setTotalPages(result.totalPages);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao carregar mais",
      );
    } finally {
      setIsAppending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header com filtros chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Filter className="size-3.5" />
          Filtrar:
        </div>
        {FILTERS.map((f) => {
          const Icon = f.icon;
          const active = activeFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              disabled={isLoading}
              onClick={() => applyFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              <Icon className="size-3.5" />
              {f.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-muted-foreground">
          {total.toLocaleString("pt-BR")} atividade
          {total === 1 ? "" : "s"}
        </span>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-muted/20 px-4 py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          icon={<Activity />}
          title="Nenhuma atividade"
          description={
            activeFilter === "all"
              ? "Quando seus leads tiverem atividades (mensagens, mudanças, tags), elas aparecem aqui."
              : "Nenhuma atividade dessa categoria. Tente outro filtro."
          }
        />
      ) : (
        <ol className="relative space-y-3 border-l border-border pl-6 ml-3">
          {activities.map((item) => {
            const meta = getTypeMeta(item.type);
            const Icon = getIconForType(item.type);
            return (
              <li key={item.id} className="relative">
                {/* Bullet do timeline */}
                <span
                  className={`absolute -left-[34px] flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background ${meta.iconBg}`}
                  aria-hidden
                >
                  <Icon className="size-3.5" />
                </span>

                <div className="rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-border hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold ${meta.tone}`}>
                        {meta.label}
                      </p>
                      {item.description && (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                      {/* Lead clicavel */}
                      {item.leads && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <Link
                            href={leadHref(item.lead_id)}
                            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                          >
                            {item.leads.name || "Lead sem nome"}
                            <ArrowRight className="size-3" />
                          </Link>
                          {item.leads.phone && (
                            <span className="text-[11px] text-muted-foreground">
                              · {item.leads.phone}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Sprint 3c: RelativeTime resolve React #418 — SSR
                        mostra data absoluta, CSR troca pro relativo apos
                        mount. O title vem do proprio component. */}
                    <RelativeTime
                      iso={item.created_at}
                      formatter={formatRelativeShortPtBR}
                      className="shrink-0 text-[11px] font-medium text-muted-foreground"
                      fallback=""
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Carregar mais */}
      {!isLoading && page < totalPages && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={isAppending}
            className="rounded-md"
          >
            {isAppending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Carregando…
              </>
            ) : (
              <>
                Carregar mais
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </div>
      )}

      {/* Estado "fim do histórico" */}
      {!isLoading && activities.length > 0 && page >= totalPages && (
        <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5" />
          Fim do histórico
        </div>
      )}
    </div>
  );
}

// Map auxiliar — icone pra cada tipo (separado pra nao poluir TYPE_META)
function getIconForType(type: string): React.ComponentType<{
  className?: string;
}> {
  if (type === "message_sent" || type === "message_received") {
    return MessageCircle;
  }
  if (type === "tag_added" || type === "tag_removed") {
    return Tags;
  }
  if (
    type === "assigned" ||
    type === "status_changed" ||
    type === "score_changed"
  ) {
    return UserCog;
  }
  // PR-B2: stage_change tem icone proprio (ArrowRight) — conota "mudou
  // de coluna" no Kanban, distinto de mudancas de campo (UserCog).
  if (type === "stage_change") return ArrowRight;
  if (type === "imported") return RefreshCw;
  return Activity;
}
