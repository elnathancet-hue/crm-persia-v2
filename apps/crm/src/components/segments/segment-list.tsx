"use client";

// Thin wrapper: o SegmentsList real vive em @persia/segments-ui
// (compartilhado com apps/admin). Aqui resolvemos role (useRole) +
// injetamos as server actions via <SegmentsProvider>.

import { SegmentsList, SegmentsProvider } from "@persia/segments-ui";
import type { Segment } from "@persia/shared/crm";
import { useRole } from "@/lib/hooks/use-role";
import { crmSegmentsActions } from "@/features/segments/crm-segments-actions";

export function SegmentList({ segments }: { segments: Segment[] }) {
  const { isAdmin } = useRole(); // CRM: only admin+ pode gerir segmentos

  return (
    <SegmentsProvider actions={crmSegmentsActions}>
      <SegmentsList initialSegments={segments} canManage={isAdmin} />
    </SegmentsProvider>
  );
}
