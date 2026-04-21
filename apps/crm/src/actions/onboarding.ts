"use server";

import { requireRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Json } from "@/types/database";

export async function getOnboardingProgress() {
  const { supabase, orgId } = await requireRole("admin");
  const { data } = await supabase
    .from("onboarding_progress")
    .select("*")
    .eq("organization_id", orgId)
    .single();
  return data;
}

export async function updateOnboardingStep(step: number, data: Record<string, unknown>) {
  const { supabase, orgId } = await requireRole("admin");

  // Get current progress
  const { data: current } = await supabase
    .from("onboarding_progress")
    .select("data")
    .eq("organization_id", orgId)
    .single();

  const mergedData: Json = { ...((current?.data as Record<string, unknown>) || {}), ...data } as Json;

  await supabase
    .from("onboarding_progress")
    .update({ step, data: mergedData })
    .eq("organization_id", orgId);

  revalidatePath("/setup");
}

export async function completeOnboarding() {
  const { supabase, orgId } = await requireRole("admin");

  // Mark onboarding as complete
  await supabase
    .from("onboarding_progress")
    .update({ completed_at: new Date().toISOString() })
    .eq("organization_id", orgId);

  await supabase
    .from("organizations")
    .update({ onboarding_completed: true })
    .eq("id", orgId);

  revalidatePath("/");
  redirect("/");
}

export async function saveAIConfig(config: {
  prompt: string;
  welcomeMsg: string;
  offHoursMsg: string;
  schedule: Json;
  tone: string;
}) {
  const { supabase, orgId } = await requireRole("admin");

  // Check if assistant exists
  const { data: existing } = await supabase
    .from("ai_assistants")
    .select("id")
    .eq("organization_id", orgId)
    .single();

  if (existing) {
    await supabase
      .from("ai_assistants")
      .update({
        prompt: config.prompt,
        welcome_msg: config.welcomeMsg,
        off_hours_msg: config.offHoursMsg,
        schedule: config.schedule,
        tone: config.tone,
      })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("ai_assistants")
      .insert({
        organization_id: orgId,
        name: "Assistente Principal",
        prompt: config.prompt,
        welcome_msg: config.welcomeMsg,
        off_hours_msg: config.offHoursMsg,
        schedule: config.schedule,
        tone: config.tone,
      });
  }

  revalidatePath("/setup");
}
