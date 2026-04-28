// @persia/segments-ui — shared Segments UI surface.

export type {
  SegmentsActions,
  CreateSegmentInput,
  UpdateSegmentInput,
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
export { ConditionBuilder } from "./components/ConditionBuilder";
