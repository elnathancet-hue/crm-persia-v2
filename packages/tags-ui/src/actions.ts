// Dependency injection for Tags UI.
//
// Sprint 2 (PR arch): contrato migrado de `Promise<Tag>` / `throw on error`
// pra `ActionResult<T>` padronizado. Apps continuam usando suas auth helpers
// (requireRole no CRM, requireSuperadminForOrg no admin) — só muda a forma
// de comunicar erro: { data, error } no lugar de throw.
//
// Ver: packages/ui/docs/patterns.md (Pattern #3) e
//      memory/project_architecture_layers.md

import type { ActionResult } from "@persia/ui";
import type { Tag, TagWithCount } from "@persia/shared/crm";

export interface CreateTagInput {
  name: string;
  color: string;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
}

export interface TagsActions {
  /** Lista tags com lead_count agregado (pra view de listagem). */
  listTagsWithCount: () => Promise<TagWithCount[]>;
  createTag: (input: CreateTagInput) => Promise<ActionResult<Tag>>;
  updateTag: (id: string, data: UpdateTagInput) => Promise<ActionResult<void>>;
  deleteTag: (id: string) => Promise<ActionResult<void>>;
}
