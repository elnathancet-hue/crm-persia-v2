"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { TagBadge } from "@persia/tags-ui";
import { Button } from "@persia/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@persia/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@persia/ui/command";
import { getTags, createTag, addTagToLead, removeTagFromLead } from "@/actions/tags";
import type { TagRef as Tag } from "@persia/shared/crm";

interface TagPickerProps {
  leadId: string;
  initialTags: Tag[];
  allTags?: Tag[];
}

const DEFAULT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#ec4899", "#64748b",
];

export function TagPicker({ leadId, initialTags, allTags: initialAllTags }: TagPickerProps) {
  const [selectedTags, setSelectedTags] = React.useState<Tag[]>(initialTags);
  const [allTags, setAllTags] = React.useState<Tag[]>(initialAllTags || []);
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!initialAllTags) {
      getTags().then((tags) => {
        if (tags) setAllTags(tags as Tag[]);
      });
    }
  }, [initialAllTags]);

  const availableTags = allTags.filter(
    (tag) => !selectedTags.some((st) => st.id === tag.id)
  );

  const filteredTags = availableTags.filter((tag) =>
    tag.name.toLowerCase().includes(search.toLowerCase())
  );

  const showCreateOption =
    search.length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === search.toLowerCase());

  async function handleAddTag(tag: Tag) {
    setLoading(true);
    try {
      await addTagToLead(leadId, tag.id);
      setSelectedTags((prev) => [...prev, tag]);
      setSearch("");
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveTag(tagId: string) {
    setLoading(true);
    try {
      await removeTagFromLead(leadId, tagId);
      setSelectedTags((prev) => prev.filter((t) => t.id !== tagId));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateAndAdd() {
    if (!search.trim()) return;
    setLoading(true);
    try {
      const randomColor = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
      const result = await createTag({ name: search.trim(), color: randomColor });
      // Sprint 2: createTag agora retorna ActionResult<Tag>.
      // Em erro, retorna { error: string }; em sucesso, { data: Tag }.
      if (result && "data" in result && result.data) {
        const tag = result.data as Tag;
        setAllTags((prev) => [tag, ...prev]);
        await addTagToLead(leadId, tag.id);
        setSelectedTags((prev) => [...prev, tag]);
        setSearch("");
      }
      // Erro silencioso preservado por compat — toast vem em PR futuro
      // quando este componente migrar pro pattern completo (Sprint 3).
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedTags.map((tag) => (
        <TagBadge
          key={tag.id}
          name={tag.name}
          color={tag.color}
          size="sm"
          onRemove={() => handleRemoveTag(tag.id)}
        />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="outline" size="xs" disabled={loading} />
          }
        >
          <Plus className="size-3" />
          Tag
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar ou criar tag..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {search ? "Nenhuma tag encontrada" : "Nenhuma tag disponivel"}
              </CommandEmpty>
              <CommandGroup>
                {filteredTags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.id}
                    onSelect={() => handleAddTag(tag)}
                  >
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </CommandItem>
                ))}
                {showCreateOption && (
                  <CommandItem
                    value={`create-${search}`}
                    onSelect={handleCreateAndAdd}
                  >
                    <Plus className="size-3 shrink-0" />
                    <span>
                      Criar &quot;{search}&quot;
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
