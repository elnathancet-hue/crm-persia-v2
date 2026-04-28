// @persia/tags-ui — shared Tags UI surface.

export type {
  TagsActions,
  CreateTagInput,
  UpdateTagInput,
} from "./actions";
export {
  TagsProvider,
  useTagsActions,
  type TagsProviderProps,
} from "./context";

export { TagsList, type TagsListProps } from "./components/TagsList";
export { TagBadge } from "./components/TagBadge";
