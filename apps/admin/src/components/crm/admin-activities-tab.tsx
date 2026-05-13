"use client";

// PR-V1c: wrapper admin do ActivitiesTab do @persia/crm-ui.
//
// Faz o fetch inicial (que o CRM cliente faz no server component pai)
// no useEffect, depois passa os dados pro componente compartilhado.
// Padrao consistente com os outros tabs admin (LeadListPage, CrmPage,
// SegmentsPage, TagsPage), todos client components com seu proprio
// fetch + NoContextFallback.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ActivitiesTab } from "@persia/crm-ui";
import type { OrgActivityRow } from "@persia/shared/crm";
import { useActiveOrg } from "@/lib/stores/client-store";
import { NoContextFallback } from "@/components/no-context-fallback";
import { getOrgActivities } from "@/actions/activities";

const PAGE_SIZE = 30;

export function AdminActivitiesTab() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [initial, setInitial] = useState<{
    activities: OrgActivityRow[];
    total: number;
    page: number;
    totalPages: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    getOrgActivities({ page: 1, limit: PAGE_SIZE })
      .then((result) => {
        setInitial({
          activities: result.activities,
          total: result.total,
          page: result.page,
          totalPages: result.totalPages,
        });
      })
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Erro ao carregar atividades",
        );
        setInitial({ activities: [], total: 0, page: 1, totalPages: 0 });
      })
      .finally(() => setLoading(false));
  }, [activeOrgId, isManagingClient]);

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  if (loading || !initial) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <ActivitiesTab
      initialActivities={initial.activities}
      initialTotal={initial.total}
      initialPage={initial.page}
      initialTotalPages={initial.totalPages}
      listActivities={getOrgActivities}
    />
  );
}
