"use client";

// Admin Tags page — agora usa o mesmo TagsList do cliente
// (@persia/tags-ui). Antes era UI legada com HTML cru + Tailwind custom.
// Mantemos isManagingClient/NoContextFallback do flow admin.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TagsList, TagsProvider } from "@persia/tags-ui";
import type { TagWithCount } from "@persia/shared/crm";
import { useActiveOrg } from "@/lib/stores/client-store";
import { NoContextFallback } from "@/components/no-context-fallback";
import { getTagsWithCount } from "@/actions/tags";
import { adminTagsActions } from "@/features/tags/admin-tags-actions";

export default function TagsPage() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    getTagsWithCount()
      .then((data) => setTags((data ?? []) as TagWithCount[]))
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Erro ao carregar tags",
        );
      })
      .finally(() => setLoading(false));
  }, [activeOrgId, isManagingClient]);

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Tags</h1>
        <p className="text-sm text-muted-foreground">
          {tags.length} {tags.length === 1 ? "tag" : "tags"}
        </p>
      </div>
      <TagsProvider actions={adminTagsActions}>
        <TagsList
          initialTags={tags}
          canCreate
          canEdit
          canDelete
        />
      </TagsProvider>
    </div>
  );
}
