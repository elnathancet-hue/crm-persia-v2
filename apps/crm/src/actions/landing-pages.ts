"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getLandingPages() {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("landing_pages")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createLandingPage(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("landing_pages")
    .insert({
      organization_id: orgId,
      title: formData.get("title") as string,
      slug: formData.get("slug") as string,
      description: (formData.get("description") as string) || null,
      cta_text: (formData.get("cta_text") as string) || "Saiba mais",
      cta_type: (formData.get("cta_type") as string) || "whatsapp",
      is_published: false,
      visits: 0,
      conversions: 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/landing-pages");
  return data;
}

export async function updateLandingPage(id: string, formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const updateData: Record<string, any> = {};
  const title = formData.get("title") as string;
  const slug = formData.get("slug") as string;
  const description = formData.get("description") as string;
  const ctaText = formData.get("cta_text") as string;
  const ctaType = formData.get("cta_type") as string;
  const isPublished = formData.get("is_published");

  if (title) updateData.title = title;
  if (slug) updateData.slug = slug;
  if (description !== null) updateData.description = description;
  if (ctaText) updateData.cta_text = ctaText;
  if (ctaType) updateData.cta_type = ctaType;
  if (isPublished !== null) updateData.is_published = isPublished === "true";

  const { error } = await supabase
    .from("landing_pages")
    .update(updateData as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/landing-pages");
}

export async function toggleLandingPagePublished(id: string, isPublished: boolean) {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase
    .from("landing_pages")
    .update({ is_published: isPublished })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/landing-pages");
}

export async function deleteLandingPage(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase.from("landing_pages").delete().eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/landing-pages");
}
