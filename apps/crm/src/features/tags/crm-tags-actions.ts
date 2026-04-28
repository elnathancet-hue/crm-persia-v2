// CRM-side TagsActions wiring.

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
