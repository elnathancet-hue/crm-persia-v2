"use client";

// PR-T4: wrapper admin do <ActivitiesTab> shared (packages/crm-ui).
//
// Admin nao tem server component que pre-fetcha em /crm (admin shell e
// client component). Entao fetcha initial no mount, depois passa pro
// componente shared que cuida do filter/loadMore via mesma action.
//
// NoContextFallback quando isManagingClient=false — mesmo flow das
// outras tabs admin (LeadListPage, SegmentsPage, TagsPage).

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
  const [activities, setActivities] = useState<OrgActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    getOrgActivities({ page: 1, limit: PAGE_SIZE })
      .then((result) => {
        setActivities(result.activities);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      })
      .catch((err) => {
        toast.error(
          err instanceof Error
            ? err.message
            : "Falha ao carregar atividades",
        );
        setActivities([]);
        setTotal(0);
        setTotalPages(0);
      })
      .finally(() => setLoading(false));
  }, [activeOrgId, isManagingClient]);

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <ActivitiesTab
      initialActivities={activities}
      initialTotal={total}
      initialPage={1}
      initialTotalPages={totalPages}
      listActivities={getOrgActivities}
    />
  );
}
