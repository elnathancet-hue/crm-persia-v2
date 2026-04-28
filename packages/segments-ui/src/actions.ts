// Dependency injection for Segments UI.

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
  createSegment: (input: CreateSegmentInput) => Promise<Segment>;
  updateSegment: (id: string, input: UpdateSegmentInput) => Promise<void>;
  deleteSegment: (id: string) => Promise<void>;
}
