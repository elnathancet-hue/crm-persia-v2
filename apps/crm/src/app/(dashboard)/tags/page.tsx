import { getTagsWithCount } from "@/actions/tags";
import { TagsPageClient } from "./tags-client";

export default async function TagsPage() {
  const tags = await getTagsWithCount();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-heading">Tags</h1>
          <p className="text-sm text-muted-foreground">
            Organize seus leads com tags coloridas
          </p>
        </div>
      </div>
      <TagsPageClient initialTags={(tags || []) as never} />
    </div>
  );
}
