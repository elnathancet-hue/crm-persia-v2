// Admin-side TagsActions wiring.
//
// requireSuperadminForOrg() le orgId do cookie assinado.
// Sprint 2: actions migraram pra ActionResult — adapter virou repasse
// direto (sem throw wrapping).

import type { TagsActions } from "@persia/tags-ui";
import type { TagWithCount } from "@persia/shared/crm";
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
  createTag: ({ name, color }) => createTag(name, color),
  updateTag: (id, data) => updateTag(id, data),
  deleteTag: (id) => deleteTag(id),
};
