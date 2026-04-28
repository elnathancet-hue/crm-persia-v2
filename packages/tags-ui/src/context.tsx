"use client";

import * as React from "react";
import type { TagsActions } from "./actions";

const TagsActionsContext = React.createContext<TagsActions | null>(null);

export interface TagsProviderProps {
  actions: TagsActions;
  children: React.ReactNode;
}

export function TagsProvider({ actions, children }: TagsProviderProps) {
  return (
    <TagsActionsContext.Provider value={actions}>
      {children}
    </TagsActionsContext.Provider>
  );
}

export function useTagsActions(): TagsActions {
  const ctx = React.useContext(TagsActionsContext);
  if (!ctx) {
    throw new Error(
      "useTagsActions must be used inside <TagsProvider actions={...}>",
    );
  }
  return ctx;
}
