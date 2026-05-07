"use client";

// Thin wrapper: o LeadsList real vive em @persia/leads-ui (compartilhado
// com apps/admin). Aqui resolvemos role (useRole) + drawer "Informacoes
// do lead" (CRM-specific) + botao Importar (PR-K1, CRM-only) e injetamos
// as server actions via <LeadsProvider>. router.refresh() dispara
// re-fetch do server component pai depois do drawer salvar.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LeadsList, LeadsProvider } from "@persia/leads-ui";
import {
  ExportMenu,
  ImportLeadsWizard,
  type ExportColumn,
  type ImportTag,
} from "@persia/crm-ui";
import type { LeadWithTags } from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import { Filter, Upload, X } from "lucide-react";
import { useRole } from "@/lib/hooks/use-role";
import { crmLeadsActions } from "@/features/leads/crm-leads-actions";
import { LeadInfoDrawer } from "@/components/leads/lead-info-drawer";
import { importLeads } from "@/actions/leads-import";
import {
  assignLead,
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
  const { isAgent } = useRole();
  // Drawer "Informacoes do lead" — CRM-specific (Fase 2, abre na linha
  // sem navegar). Mantido aqui (nao no pacote) porque o admin nao tem
  // essa feature ainda.
  const [infoDrawerLead, setInfoDrawerLead] =
    React.useState<LeadWithTags | null>(null);

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

  // Export columns (PR-K3) — exporta a pagina atual de leads. Pra
  // exportar TUDO, usuario aplica filtro ou usa CSV pelo SQL Editor.
  const leadExportColumns = React.useMemo<ExportColumn<LeadWithTags>[]>(
    () => [
      { header: "Nome", accessor: (l) => l.name ?? "" },
      { header: "Telefone", accessor: (l) => l.phone ?? "" },
      { header: "E-mail", accessor: (l) => l.email ?? "" },
      { header: "Status", accessor: (l) => l.status ?? "" },
      { header: "Origem", accessor: (l) => l.source ?? "" },
      { header: "Score", accessor: (l) => l.score ?? 0 },
      { header: "Canal", accessor: (l) => l.channel ?? "" },
      {
        header: "Tags",
        accessor: (l) =>
          (l.lead_tags ?? [])
            .map((lt) => lt.tags?.name ?? "")
            .filter(Boolean)
            .join(", "),
      },
      {
        header: "Cidade",
        accessor: (l) => l.address_city ?? "",
      },
      {
        header: "Estado",
        accessor: (l) => l.address_state ?? "",
      },
      {
        header: "Ultima interacao",
        accessor: (l) =>
          l.last_interaction_at ? new Date(l.last_interaction_at) : "",
      },
      {
        header: "Criado em",
        accessor: (l) => (l.created_at ? new Date(l.created_at) : ""),
      },
    ],
    [],
  );

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
          onEditLead={(lead) => router.push(`/leads/${lead.id}`)}
          onDeleteLead={(lead) => router.push(`/leads/${lead.id}`)}
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
          headerActions={
            <>
              <ExportMenu
                rows={props.initialLeads}
                columns={leadExportColumns}
                filenamePrefix="leads"
                sheetName="Leads"
                triggerSize="default"
                className="h-9 rounded-md px-3"
              />
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
      </LeadsProvider>

      {infoDrawerLead ? (
        <LeadInfoDrawer
          open={!!infoDrawerLead}
          onOpenChange={(open) => {
            if (!open) setInfoDrawerLead(null);
          }}
          lead={infoDrawerLead}
          onSaved={() => router.refresh()}
        />
      ) : null}

      <ImportLeadsWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        tags={importTags}
        onImport={importLeads}
        onImported={() => router.refresh()}
        segmentsBasePath="/segments"
      />
    </>
  );
}
