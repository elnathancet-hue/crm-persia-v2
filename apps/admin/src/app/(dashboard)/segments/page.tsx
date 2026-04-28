"use client";

// Admin Segments page — agora usa o mesmo SegmentsList do cliente
// (@persia/segments-ui). Antes era UI legada com HTML cru + custom modal
// + ConditionBuilder duplicado inline (~258 linhas). Mantemos
// isManagingClient/NoContextFallback do flow admin.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SegmentsList, SegmentsProvider } from "@persia/segments-ui";
import type { Segment } from "@persia/shared/crm";
import { useActiveOrg } from "@/lib/stores/client-store";
import { NoContextFallback } from "@/components/no-context-fallback";
import { getSegments } from "@/actions/segments";
import { adminSegmentsActions } from "@/features/segments/admin-segments-actions";

export default function SegmentsPage() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    getSegments()
      .then((data) => setSegments((data ?? []) as unknown as Segment[]))
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Erro ao carregar segmentos",
        );
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
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Segmentações</h1>
        <p className="text-sm text-muted-foreground">
          {segments.length}{" "}
          {segments.length === 1 ? "segmento" : "segmentos"}
        </p>
      </div>
      <SegmentsProvider actions={adminSegmentsActions}>
        <SegmentsList initialSegments={segments} canManage />
      </SegmentsProvider>
    </div>
  );
}
