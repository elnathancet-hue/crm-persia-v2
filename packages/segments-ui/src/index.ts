// @persia/segments-ui — shared Segments UI surface.

export type {
  SegmentsActions,
  CreateSegmentInput,
  UpdateSegmentInput,
  SegmentPreviewResult,
  SegmentPreviewSample,
} from "./actions";
export {
  SegmentsProvider,
  useSegmentsActions,
  type SegmentsProviderProps,
} from "./context";

export {
  SegmentsList,
  type SegmentsListProps,
} from "./components/SegmentsList";
export {
  ConditionBuilder,
  type AssigneeOption,
  type TagOption,
  type SegmentCatalogs,
} from "./components/ConditionBuilder";
