// CRM-side SegmentsActions wiring.
//
// O createSegment/updateSegment do CRM aceita FormData (legacy do
// formulario antigo). O pacote @persia/segments-ui passa shape de
// objeto, entao convertemos pra FormData aqui.

import type { SegmentsActions } from "@persia/segments-ui";
import type { Segment } from "@persia/shared/crm";
import {
  createSegment,
  deleteSegment,
  getSegments,
  updateSegment,
} from "@/actions/segments";

function toFormData(input: {
  name?: string;
  description?: string;
  rules?: unknown;
}): FormData {
  const fd = new FormData();
  if (input.name !== undefined) fd.set("name", input.name);
  if (input.description !== undefined) fd.set("description", input.description);
  if (input.rules !== undefined) {
    fd.set("rules", JSON.stringify(input.rules));
  }
  return fd;
}

export const crmSegmentsActions: SegmentsActions = {
  listSegments: async () => {
    const segments = await getSegments();
    return (segments ?? []) as unknown as Segment[];
  },
  createSegment: async (input) => {
    const created = await createSegment(toFormData(input));
    return created as unknown as Segment;
  },
  updateSegment: async (id, input) => {
    await updateSegment(id, toFormData(input));
  },
  deleteSegment: (id) => deleteSegment(id),
};
