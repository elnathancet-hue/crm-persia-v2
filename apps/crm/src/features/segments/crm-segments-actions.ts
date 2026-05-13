// CRM-side SegmentsActions wiring.
//
// Sprint 3: virou repasse direto. Antes convertíamos `{ name, description,
// rules }` pra FormData porque a action legacy esperava FormData (residuo
// do form HTML antigo). Agora a action aceita objeto + retorna ActionResult.

import type { SegmentsActions } from "@persia/segments-ui";
import type { Segment } from "@persia/shared/crm";
import type { ActionResult } from "@persia/ui";
import {
  createSegment,
  deleteSegment,
  getSegments,
  updateSegment,
} from "@/actions/segments";

export const crmSegmentsActions: SegmentsActions = {
  listSegments: async () => {
    const segments = await getSegments();
    return (segments ?? []) as unknown as Segment[];
  },
  createSegment: (input) =>
    createSegment(input) as Promise<ActionResult<Segment>>,
  updateSegment: (id, input) => updateSegment(id, input),
  deleteSegment: (id) => deleteSegment(id),
};
