// Admin-side TagsActions wiring.
//
// requireSuperadminForOrg() le orgId do cookie assinado. As actions do
// admin existentes retornam shape `{ data, error }`; aqui embrulhamos
// no contrato canonico do @persia/tags-ui (throw em erro).

import type { TagsActions } from "@persia/tags-ui";
import type { Tag, TagWithCount } from "@persia/shared/crm";
import {
  createTag,
  deleteTag,
  getTagsWithCount,
  updateTag,
} from "@/actions/tags";

export const adminTagsActions: TagsActions = {
  listTagsWithCount: async () => {
    const tags = await getTagsWithCount();
    return tags as TagWithCount[];
  },
  createTag: async ({ name, color }) => {
    const result = await createTag(name, color);
    if (result.error || !result.data) {
      throw new Error(result.error ?? "Erro ao criar tag");
    }
    return result.data as Tag;
  },
  updateTag: async (id, data) => {
    const result = await updateTag(id, data);
    if (result.error) throw new Error(result.error);
  },
  deleteTag: async (id) => {
    const result = await deleteTag(id);
    if (result.error) throw new Error(result.error);
  },
};
