"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function getTools() {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("automation_tools")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createTool(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const category = formData.get("category") as string || "documento";
  const file = formData.get("file") as File;

  if (!name?.trim()) throw new Error("Nome obrigatorio");
  if (!file || file.size === 0) throw new Error("Arquivo obrigatorio");

  // Upload to Supabase Storage
  const ext = file.name.split(".").pop() || "bin";
  const storagePath = `${orgId}/${Date.now()}-${slugify(name)}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("tools")
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadErr) throw new Error(`Upload falhou: ${uploadErr.message}`);

  // Get public URL
  const { data: urlData } = supabase.storage.from("tools").getPublicUrl(storagePath);
  const fileUrl = urlData.publicUrl;

  // Save to DB
  const slug = slugify(name);
  const { data, error } = await supabase
    .from("automation_tools")
    .insert({
      organization_id: orgId,
      name: name.trim(),
      description: description?.trim() || null,
      category,
      file_url: fileUrl,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      slug,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/automations/tools");
  return data;
}

export async function updateTool(id: string, data: { name?: string; description?: string; category?: string; is_active?: boolean }) {
  const { supabase, orgId } = await requireRole("admin");

  const updates: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() };
  if (data.name) updates.slug = slugify(data.name);

  const { error } = await supabase
    .from("automation_tools")
    .update(updates as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/automations/tools");
}

export async function deleteTool(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  // Get file path to delete from storage
  const { data: tool } = await supabase
    .from("automation_tools")
    .select("file_url")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (tool?.file_url) {
    const path = tool.file_url.split("/tools/")[1];
    if (path) {
      await supabase.storage.from("tools").remove([decodeURIComponent(path)]);
    }
  }

  const { error } = await supabase
    .from("automation_tools")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/automations/tools");
}
