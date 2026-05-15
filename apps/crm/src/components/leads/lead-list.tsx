"use client";

// Thin wrapper: o LeadsList real vive em @persia/leads-ui (compartilhado
// com apps/admin). Aqui resolvemos role (useRole) + drawer "Informacoes
// do lead" (CRM-specific) + botao Importar (PR-K1, CRM-only) e injetamos
// as server actions via <LeadsProvider>. router.refresh() dispara
// re-fetch do server component pai depois do drawer salvar.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ExportLeadsDialog,
  type ExportLeadsDialogProps,
  LeadInfoDrawer,
  LeadsList,
  LeadsProvider,
  useDebouncedCallback,
  useLeadsRealtime,
} from "@persia/leads-ui";
import {
  ImportLeadsWizard,
  type ImportTag,
  downloadExport,
  makeExportFilename,
} from "@persia/crm-ui";
import type { LeadWithTags } from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import { Download, Filter, Upload, X } from "lucide-react";
import { useRole } from "@/lib/hooks/use-role";
import { useCurrentOrgId } from "@/lib/realtime/use-current-org-id";
import { crmLeadsActions } from "@/features/leads/crm-leads-actions";
import { createClient } from "@/lib/supabase/client";
import { importLeads } from "@/actions/leads-import";
import {
  assignLead,
  bulkAssignLeads,
  bulkDeleteLeads,
  countLeadsForExport,
  fetchLeadsForExport,
  getLead,
  getOrgTags,
  type LeadListItemStats,
} from "@/actions/leads";
import { findOrCreateConversationByLead } from "@/actions/conversations";

interface Props {
  initialLeads: LeadWithTags[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  /** PR-L3: stats enriquecidas pra colunas extras. Map<leadId, stats>. */
  initialStats?: Map<string, LeadListItemStats>;
  /** PR-L3: lista de membros pra dropdown "Atribuir responsavel" inline. */
  assignees?: { id: string; name: string }[];
  /**
   * PR-CRMOPS3: quando setado, mostra hint visual no topo da lista
   * indicando que o resultado esta filtrado pelo segmento. Botao
   * "Limpar" remove o filtro (limpa ?segment=... da URL).
   */
  activeSegment?: { id: string; name: string } | null;
}

export function LeadList(props: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAgent } = useRole();
  const orgId = useCurrentOrgId();
  // PR-U2: supabase client pro <LeadInfoDrawer> (DI). Singleton — chamar
  // direto e seguro.
  const supabase = createClient();

  // PR-O Realtime + PR-P debounce: outro agente criou/editou/deletou
  // lead nesta org. Debounce 200ms agrupa burst (bulk import, bulk
  // delete) num refetch unico ao inves de N. RLS + filtro
  // organization_id no canal sao defesa em camada.
  const debouncedRefresh = useDebouncedCallback(() => router.refresh());
  // PR-V1a: hook recebe supabase via DI agora.
  useLeadsRealtime(supabase, orgId, debouncedRefresh);


  // Drawer "Informacoes do lead" — CRM-specific (Fase 2, abre na linha
  // sem navegar). Mantido aqui (nao no pacote) porque o admin nao tem
  // essa feature ainda.
  const [infoDrawerLead, setInfoDrawerLead] =
    React.useState<LeadWithTags | null>(null);

  // === Deeplink ?lead=UUID (Frente A: unificação) ============================
  // Suporta URL `/crm?tab=leads&lead={UUID}` abrindo o drawer naquele
  // lead. Usado por:
  //   - Redirect 308 de /leads/{UUID} (rota legacy deprecada)
  //   - Links externos que queiram apontar pra um lead específico
  //   - Bookmarks antigos (URL continua linkavel)
  //
  // 1. Procura primeiro na pagina atual de leads (rapido, sem fetch)
  // 2. Fallback: getLead() pra buscar leads de paginas não-carregadas
  // ==========================================================================
  const deeplinkLeadId = searchParams.get("lead");
  React.useEffect(() => {
    if (!deeplinkLeadId) return;
    // Evita re-abrir se o drawer ja esta com esse lead
    if (infoDrawerLead?.id === deeplinkLeadId) return;

    const found = props.initialLeads.find((l) => l.id === deeplinkLeadId);
    if (found) {
      setInfoDrawerLead(found);
      return;
    }

    let cancelled = false;
    // Lead nao esta na pagina atual — busca via server action.
    // getLead retorna { lead, activities }; aqui usamos so o lead.
    getLead(deeplinkLeadId)
      .then((res) => {
        if (!cancelled && res?.lead) {
          setInfoDrawerLead(res.lead as unknown as LeadWithTags);
        }
      })
      .catch(() => {
        /* silencioso — lead nao encontrado/sem permissao, ignora */
      });
    return () => {
      cancelled = true;
    };
  }, [deeplinkLeadId, props.initialLeads, infoDrawerLead?.id]);

  // Import wizard (PR-K1) — CRM-only por enquanto.
  const [importOpen, setImportOpen] = React.useState(false);
  const [importTags, setImportTags] = React.useState<ImportTag[]>([]);

  const openImport = React.useCallback(async () => {
    try {
      const tags = await getOrgTags();
      setImportTags(
        tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      );
    } catch {
      setImportTags([]);
    }
    setImportOpen(true);
  }, []);

  // Export columns — Dialog de exportar com filtros + selector de colunas.
  // Substitui o antigo ExportMenu que so baixava a pagina atual (max 20).
  // Cada coluna tem `default: false` se nao queremos marcar por padrao.
  const exportColumns = React.useMemo(
    () => [
      { key: "name", label: "Nome", accessor: (l: LeadWithTags) => l.name ?? "" },
      { key: "phone", label: "Telefone", accessor: (l: LeadWithTags) => l.phone ?? "" },
      { key: "email", label: "E-mail", accessor: (l: LeadWithTags) => l.email ?? "" },
      { key: "status", label: "Status", accessor: (l: LeadWithTags) => l.status ?? "" },
      { key: "source", label: "Origem", accessor: (l: LeadWithTags) => l.source ?? "" },
      { key: "score", label: "Score", accessor: (l: LeadWithTags) => l.score ?? 0 },
      { key: "channel", label: "Canal", accessor: (l: LeadWithTags) => l.channel ?? "" },
      {
        key: "tags",
        label: "Tags",
        accessor: (l: LeadWithTags) =>
          (l.lead_tags ?? [])
            .map((lt) => lt.tags?.name ?? "")
            .filter(Boolean)
            .join(", "),
      },
      {
        key: "address_city",
        label: "Cidade",
        accessor: (l: LeadWithTags) => l.address_city ?? "",
        default: false,
      },
      {
        key: "address_state",
        label: "Estado",
        accessor: (l: LeadWithTags) => l.address_state ?? "",
        default: false,
      },
      {
        key: "last_interaction_at",
        label: "Última interação",
        accessor: (l: LeadWithTags) =>
          l.last_interaction_at ? new Date(l.last_interaction_at) : "",
      },
      {
        key: "created_at",
        label: "Criado em",
        accessor: (l: LeadWithTags) => (l.created_at ? new Date(l.created_at) : ""),
      },
      {
        key: "notes",
        label: "Anotações",
        accessor: (l: LeadWithTags) => l.notes ?? "",
        default: false,
      },
    ],
    [],
  );

  // === Dialog Exportar Leads (PR Export+Filters) ===
  const [exportOpen, setExportOpen] = React.useState(false);

  // Origens conhecidas — deriva do props.initialLeads (auto-extracao).
  // Senao tiver dados, comeca com lista comum.
  const knownSources = React.useMemo(() => {
    const set = new Set<string>();
    for (const l of props.initialLeads) {
      if (l.source) set.add(l.source);
    }
    if (set.size === 0) {
      // fallback default
      ["whatsapp", "manual", "import", "form", "api"].forEach((s) => set.add(s));
    }
    return Array.from(set).sort();
  }, [props.initialLeads]);

  // Handler de download — reusa downloadExport do @persia/crm-ui mas
  // adapta os ExportLeadColumn pro shape esperado (header/accessor).
  const handleDownload: ExportLeadsDialogProps["onDownload"] = (
    rows,
    cols,
    format,
  ) => {
    return downloadExport({
      rows,
      columns: cols.map((c) => ({ header: c.label, accessor: c.accessor })),
      filename: makeExportFilename("leads"),
      format,
      sheetName: "Leads",
    });
  };

  return (
    <>
      {/* PR-CRMOPS3: hint de filtro ativo. Quando o usuario chega via
          "Ver leads" do card de segmento, mostra a pilula com nome
          do segmento + botao "x" pra limpar. DesignFlow: bg-primary/10
          + text-primary + rounded-full. */}
      {props.activeSegment && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Filter className="size-4 text-primary shrink-0" aria-hidden />
            <span className="text-sm text-foreground truncate">
              Filtrado por segmento:{" "}
              <span className="font-semibold text-primary">
                {props.activeSegment.name}
              </span>
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              · {props.initialTotal} lead{props.initialTotal === 1 ? "" : "s"}
            </span>
          </div>
          <Link
            href="/crm?tab=leads"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground"
            title="Limpar filtro"
          >
            <X className="size-3.5" aria-hidden />
            Limpar
          </Link>
        </div>
      )}
      <LeadsProvider actions={crmLeadsActions}>
        <LeadsList
          initialLeads={props.initialLeads}
          initialTotal={props.initialTotal}
          initialPage={props.initialPage}
          initialTotalPages={props.initialTotalPages}
          // PR-L3: props enriquecidas
          initialStats={props.initialStats}
          assignees={props.assignees ?? []}
          canEdit={isAgent}
          onRowClick={(lead) => setInfoDrawerLead(lead)}
          // Frente A (unificação): ⋮ → Editar/Excluir agora abrem o
          // mesmo LeadInfoDrawer que clicar na linha. Resolve:
          //   - bug crash da rota legacy (LeadsProvider missing)
          //   - duplicação de fluxo (drawer já tem edit form + delete)
          //   - inconsistência UX (2 caminhos pra mesma ação)
          // A rota /leads/[id] agora redireciona pro /crm com drawer aberto.
          onEditLead={(lead) => setInfoDrawerLead(lead)}
          onDeleteLead={(lead) => setInfoDrawerLead(lead)}
          // PR-L3: CTAs inline por linha (menu ⋯ extendido)
          onAssignLead={async (leadId, userId) => {
            await assignLead(leadId, userId);
            router.refresh();
          }}
          onCreateDeal={(lead) => {
            // Navega pro Kanban no funil padrao (deal sera criado lá)
            router.push(`/crm?leadId=${lead.id}`);
          }}
          onOpenConversation={async (lead) => {
            try {
              const { conversationId } = await findOrCreateConversationByLead(
                lead.id,
              );
              router.push(`/chat?id=${conversationId}`);
            } catch (err) {
              console.error("[LeadList] open conversation failed:", err);
            }
          }}
          onScheduleAppointment={(lead) => {
            router.push(`/agenda?leadId=${lead.id}`);
          }}
          // PR-L4: bulk operations (atribuir / excluir)
          onBulkAssign={async (leadIds, userId) => {
            const result = await bulkAssignLeads(leadIds, userId);
            router.refresh();
            return result;
          }}
          onBulkDelete={async (leadIds) => {
            const result = await bulkDeleteLeads(leadIds);
            router.refresh();
            return result;
          }}
          headerActions={
            <>
              <Button
                variant="outline"
                onClick={() => setExportOpen(true)}
                className="h-9 rounded-md"
              >
                <Download className="size-4" data-icon="inline-start" />
                Exportar
              </Button>
              {isAgent ? (
                <Button
                  variant="outline"
                  onClick={openImport}
                  className="h-9 rounded-md"
                >
                  <Upload className="size-4" data-icon="inline-start" />
                  Importar
                </Button>
              ) : null}
            </>
          }
        />
        {/* PR-S1: Drawer dentro do LeadsProvider pra que o
            <LeadCommentsTab> (shared do pacote) consuma as
            comment actions via useLeadsActions(). */}
        {infoDrawerLead ? (
          <LeadInfoDrawer
            open={!!infoDrawerLead}
            onOpenChange={(open) => {
              if (!open) {
                setInfoDrawerLead(null);
                // Limpa ?lead=UUID da URL pra nao re-abrir em re-renders.
                if (searchParams.get("lead")) {
                  const next = new URLSearchParams(searchParams.toString());
                  next.delete("lead");
                  const qs = next.toString();
                  router.replace(qs ? `/crm?${qs}` : "/crm", { scroll: false });
                }
              }
            }}
            lead={infoDrawerLead}
            onSaved={() => router.refresh()}
            supabase={supabase}
            // PR-U3: gates de role injetados aqui (regra: pacote nao usa useRole).
            // Agent+ pode editar e excluir. Viewer (futuro) so visualiza.
            canEdit={isAgent}
            canDelete={isAgent}
            // PR-B6: passa members pro Select "Responsável" do drawer
            // resolver UUID -> nome. Reusa o array `assignees` que ja
            // chega pra dropdown "Atribuir" inline da lista. Shape
            // {id, name} mapeado pra {user_id, name} (contrato do drawer).
            members={(props.assignees ?? []).map((a) => ({
              user_id: a.id,
              name: a.name,
            }))}
            onDeleted={() => {
              setInfoDrawerLead(null);
              router.refresh();
            }}
          />
        ) : null}
      </LeadsProvider>

      <ImportLeadsWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        tags={importTags}
        onImport={importLeads}
        onImported={() => router.refresh()}
        segmentsBasePath="/segments"
      />

      {/* PR Export+Filters: Dialog centralizado pra exportar com filtros.
          Substitui o ExportMenu antigo (popover) que so baixava a pagina
          atual. Agora pagina internamente em chunks de 1000 ate trazer
          todos os leads que batem nos filtros (cap 100k defensivo). */}
      <ExportLeadsDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        initialFilters={{}}
        countLeads={(filters) => countLeadsForExport(filters)}
        fetchAllLeads={(filters) => fetchLeadsForExport(filters)}
        onDownload={handleDownload}
        assignees={props.assignees ?? []}
        sources={knownSources}
        availableColumns={exportColumns}
      />
    </>
  );
}
