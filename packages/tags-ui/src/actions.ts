// Dependency injection for Tags UI.

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
  createTag: (input: CreateTagInput) => Promise<Tag>;
  updateTag: (id: string, data: UpdateTagInput) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
}
