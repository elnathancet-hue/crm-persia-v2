// Admin-side SegmentsActions wiring.
//
// Sprint 3: actions migraram pra ActionResult — adapter virou repasse direto.

import type { SegmentsActions } from "@persia/segments-ui";
import type { Segment } from "@persia/shared/crm";
import type { ActionResult } from "@persia/ui";
import {
  createSegment,
  deleteSegment,
  getSegments,
  updateSegment,
} from "@/actions/segments";

export const adminSegmentsActions: SegmentsActions = {
  listSegments: async () => {
    const segments = await getSegments();
    return (segments ?? []) as unknown as Segment[];
  },
  createSegment: ({ name, description, rules }) =>
    createSegment({ name, description, rules }) as Promise<ActionResult<Segment>>,
  updateSegment: (id, input) => updateSegment(id, input),
  deleteSegment: (id) => deleteSegment(id),
};
