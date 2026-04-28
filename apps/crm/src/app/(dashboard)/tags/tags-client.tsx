"use client";

// Thin wrapper: o TagsList real vive em @persia/tags-ui (compartilhado
// com apps/admin). Aqui resolvemos role (useRole) + injetamos as server
// actions via <TagsProvider>.

import { TagsList, TagsProvider } from "@persia/tags-ui";
import type { TagWithCount } from "@persia/shared/crm";
import { useRole } from "@/lib/hooks/use-role";
import { crmTagsActions } from "@/features/tags/crm-tags-actions";

interface Props {
  initialTags: TagWithCount[];
}

export function TagsPageClient({ initialTags }: Props) {
  const { isAgent, isAdmin } = useRole();

  return (
    <TagsProvider actions={crmTagsActions}>
      <TagsList
        initialTags={initialTags}
        canCreate={isAgent}
        canEdit={isAgent}
        canDelete={isAdmin}
      />
    </TagsProvider>
  );
}
