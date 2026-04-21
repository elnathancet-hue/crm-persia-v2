import { getAuditLogs, getAuditFilterOptions } from "@/actions/admin";
import { AuditClient } from "./audit-client";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function AuditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const offset = Number(pickString(params.offset) || 0) || 0;
  const filters = {
    action: pickString(params.action),
    orgId: pickString(params.org),
    since: pickString(params.since),
    until: pickString(params.until),
    limit: 50,
    offset,
  };

  const [{ rows, total }, options] = await Promise.all([
    getAuditLogs(filters),
    getAuditFilterOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Auditoria</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Registro de todas as acoes de superadmin no sistema
        </p>
      </div>
      <AuditClient
        initialRows={rows}
        initialTotal={total}
        initialOffset={offset}
        initialFilters={{
          action: filters.action || "",
          orgId: filters.orgId || "",
          since: filters.since || "",
          until: filters.until || "",
        }}
        actions={options.actions}
        orgs={options.orgs}
      />
    </div>
  );
}
