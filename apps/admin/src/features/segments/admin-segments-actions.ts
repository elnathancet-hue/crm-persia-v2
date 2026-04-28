// Admin-side SegmentsActions wiring.

import type { SegmentsActions } from "@persia/segments-ui";
import type { Segment } from "@persia/shared/crm";
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
  createSegment: async ({ name, description, rules }) => {
    const result = await createSegment({
      name,
      description,
      rules,
    });
    if (result.error || !result.data) {
      throw new Error(result.error ?? "Erro ao criar segmento");
    }
    return result.data as unknown as Segment;
  },
  updateSegment: async (id, input) => {
    const result = await updateSegment(id, {
      name: input.name,
      description: input.description,
      rules: input.rules,
    });
    if (result.error) throw new Error(result.error);
  },
  deleteSegment: async (id) => {
    const result = await deleteSegment(id);
    if (result.error) throw new Error(result.error);
  },
};
