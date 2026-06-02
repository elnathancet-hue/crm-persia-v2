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

// Etapa 4: retorno do preview de quantidade antes de salvar.
export interface SegmentPreviewSample {
  id: string;
  name: string | null;
  phone: string | null;
  status: string;
  source: string;
}

export interface SegmentPreviewResult {
  count: number;
  sample: SegmentPreviewSample[];
  warnings: string[];
}

export interface SegmentsActions {
  listSegments: () => Promise<Segment[]>;
  createSegment: (input: CreateSegmentInput) => Promise<ActionResult<Segment>>;
  updateSegment: (
    id: string,
    input: UpdateSegmentInput,
  ) => Promise<ActionResult<void>>;
  deleteSegment: (id: string) => Promise<ActionResult<void>>;
  /**
   * Etapa 4: conta quantos leads bateriam com as regras dadas, sem
   * salvar nada. Opcional — apps que não implementam ignoram o preview.
   */
  previewSegmentRules?: (rules: SegmentRules) => Promise<SegmentPreviewResult>;
  /**
   * Etapa 8: cria uma cópia do segmento com nome "Cópia de {nome}".
   * Opcional — cards ocultam o botão quando ausente.
   */
  duplicateSegment?: (id: string) => Promise<ActionResult<Segment>>;
}
