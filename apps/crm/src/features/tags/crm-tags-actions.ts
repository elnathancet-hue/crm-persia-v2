// CRM-side TagsActions wiring.
//
// Sprint 2: contrato canônico migrou pra ActionResult, então o adapter
// virou repasse direto (sem throw/catch wrapping). Actions de @/actions/tags
// já retornam ActionResult.

import type { TagsActions } from "@persia/tags-ui";
import {
  createTag,
  deleteTag,
  getTagsWithCount,
  updateTag,
} from "@/actions/tags";

export const crmTagsActions: TagsActions = {
  listTagsWithCount: () => getTagsWithCount(),
  createTag: ({ name, color }) => createTag({ name, color }),
  updateTag: (id, data) => updateTag(id, data),
  deleteTag: (id) => deleteTag(id),
};
