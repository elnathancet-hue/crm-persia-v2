"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateUserProfile(input: {
  full_name: string;
  phone: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: input.full_name.trim(),
      phone: input.phone.trim(),
    })
    .eq("id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function changeUserPassword(newPassword: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function uploadUserAvatar(formData: FormData): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const file = formData.get("file") as File;
  if (!file || file.size === 0) throw new Error("Arquivo inválido");
  if (file.size > 2 * 1024 * 1024) throw new Error("Foto deve ter no máximo 2MB");

  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `${user.id}/avatar.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: true });

  if (uploadErr) throw new Error(`Upload falhou: ${uploadErr.message}`);

  // Adiciona cache-buster pra forçar refresh da imagem no browser
  const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  return avatarUrl;
}

export async function getUserProfile(): Promise<{
  full_name: string;
  phone: string;
  avatar_url: string;
  email: string;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return {
    full_name: (profile as any)?.full_name || "",
    phone: (profile as any)?.phone || "",
    avatar_url: (profile as any)?.avatar_url || "",
    email: user.email || "",
  };
}
