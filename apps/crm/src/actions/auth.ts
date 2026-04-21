"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function signUp(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const fullName = formData.get("fullName") as string;
  const company = formData.get("company") as string;
  const niche = formData.get("niche") as string;

  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });

  if (authError) throw new Error(authError.message);
  if (!authData.user) throw new Error("Erro ao criar usuario");

  // 2. Create organization
  const slug = company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    + "-" + Math.random().toString(36).substring(2, 6);

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({
      name: company,
      slug,
      niche,
    })
    .select()
    .single();

  if (orgError) throw new Error(orgError.message);

  // 3. Add user as owner
  await supabase.from("organization_members").insert({
    organization_id: org.id,
    user_id: authData.user.id,
    role: "owner",
  });

  // 4. Create onboarding progress
  await supabase.from("onboarding_progress").insert({
    organization_id: org.id,
    step: 1,
  });

  revalidatePath("/");
  redirect("/setup");
}

export async function signIn(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function forgotPassword(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(
    formData.get("email") as string,
    { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password` }
  );

  if (error) throw new Error(error.message);
  return { success: true };
}
