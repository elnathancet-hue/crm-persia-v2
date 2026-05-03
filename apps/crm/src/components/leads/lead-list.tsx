"use client";

// Thin wrapper: o LeadsList real vive em @persia/leads-ui (compartilhado
// com apps/admin). Aqui resolvemos role (useRole) + drawer "Informacoes
// do lead" (CRM-specific) + botao Importar (PR-K1, CRM-only) e injetamos
// as server actions via <LeadsProvider>. router.refresh() dispara
// re-fetch do server component pai depois do drawer salvar.

import * as React from "react";
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
import { Upload } from "lucide-react";
import { useRole } from "@/lib/hooks/use-role";
import { crmLeadsActions } from "@/features/leads/crm-leads-actions";
import { LeadInfoDrawer } from "@/components/leads/lead-info-drawer";
import { importLeads } from "@/actions/leads-import";
import { getOrgTags } from "@/actions/leads";

interface Props {
  initialLeads: LeadWithTags[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
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
      <LeadsProvider actions={crmLeadsActions}>
        <LeadsList
          {...props}
          canEdit={isAgent}
          onRowClick={(lead) => setInfoDrawerLead(lead)}
          onEditLead={(lead) => router.push(`/leads/${lead.id}`)}
          onDeleteLead={(lead) => router.push(`/leads/${lead.id}`)}
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
