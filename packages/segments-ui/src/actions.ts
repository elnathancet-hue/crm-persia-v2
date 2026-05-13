// Dependency injection for Segments UI.
//
// Sprint 3 (PR arch): contrato migrou pra ActionResult. Apps continuam
// usando suas auth helpers; só muda a forma de comunicar erro:
// { data, error } no lugar de throw.

import type { ActionResult } from "@persia/ui";
import type { Segment, SegmentRules } from "@persia/shared/crm";

export interface CreateSegmentInput {
  name: string;
  description?: string;
  rules: SegmentRules;
}

export interface UpdateSegmentInput {
  name?: string;
  description?: string;
  rules?: SegmentRules;
}

export interface SegmentsActions {
  listSegments: () => Promise<Segment[]>;
  createSegment: (input: CreateSegmentInput) => Promise<ActionResult<Segment>>;
  updateSegment: (
    id: string,
    input: UpdateSegmentInput,
  ) => Promise<ActionResult<void>>;
  deleteSegment: (id: string) => Promise<ActionResult<void>>;
}
