"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { chatCompletion } from "@/lib/ai/openai";
import type { Json } from "@/types/database";

// ---- List all assistants ----
export async function getAssistants() {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("ai_assistants")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

// ---- Get single assistant (first one, for backward compat) ----
export async function getAssistant() {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("ai_assistants")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") throw new Error(error.message);
  return data;
}

// ---- Create assistant ----
export async function createAssistant(data: {
  name?: string;
  prompt: string;
  description?: string;
  category?: string;
  welcome_msg?: string;
  off_hours_msg?: string;
  schedule?: Json;
  tone?: string;
  model?: string;
  is_active?: boolean;
  message_splitting?: Json;
}) {
  const { supabase, orgId } = await requireRole("admin");

  const { data: assistant, error } = await supabase
    .from("ai_assistants")
    .insert({
      organization_id: orgId,
      name: data.name || "Assistente IA",
      prompt: data.prompt,
      description: data.description || null,
      category: data.category || "geral",
      welcome_msg: data.welcome_msg || null,
      off_hours_msg: data.off_hours_msg || null,
      schedule: data.schedule || { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
      tone: data.tone || "amigavel",
      model: data.model || "gpt-4.1-mini",
      is_active: data.is_active ?? true,
      message_splitting: data.message_splitting || { enabled: false, threshold: 100, delay_seconds: 2 },
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/automations/assistant");
  return assistant;
}

// ---- Update assistant ----
export async function updateAssistant(
  id: string,
  data: {
    name?: string;
    prompt?: string;
    description?: string;
    category?: string;
    welcome_msg?: string;
    off_hours_msg?: string;
    schedule?: Json;
    tone?: string;
    model?: string;
    is_active?: boolean;
    message_splitting?: Json;
  }
) {
  const { supabase, orgId } = await requireRole("admin");

  // Whitelist explícita — evita mass assignment caso o payload serializado
  // carregue chaves extras (organization_id, id, etc.).
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.name !== undefined)               patch.name = data.name;
  if (data.prompt !== undefined)             patch.prompt = data.prompt;
  if (data.description !== undefined)        patch.description = data.description;
  if (data.category !== undefined)           patch.category = data.category;
  if (data.welcome_msg !== undefined)        patch.welcome_msg = data.welcome_msg;
  if (data.off_hours_msg !== undefined)      patch.off_hours_msg = data.off_hours_msg;
  if (data.schedule !== undefined)           patch.schedule = data.schedule;
  if (data.tone !== undefined)               patch.tone = data.tone;
  if (data.model !== undefined)              patch.model = data.model;
  if (data.is_active !== undefined)          patch.is_active = data.is_active;
  if (data.message_splitting !== undefined)  patch.message_splitting = data.message_splitting;

  const { error } = await supabase
    .from("ai_assistants")
    .update(patch as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/automations/assistant");
}

// ---- Delete assistant ----
export async function deleteAssistant(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase
    .from("ai_assistants")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/automations/assistant");
}

// ---- Test assistant ----
export async function testAssistant(
  assistantId: string,
  message: string
): Promise<{ response: string; error?: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      response: "",
      error: "Configure sua chave OpenAI nas variaveis de ambiente (OPENAI_API_KEY)",
    };
  }

  const { supabase, orgId } = await requireRole("admin");

  const { data: assistant, error } = await supabase
    .from("ai_assistants")
    .select("*")
    .eq("id", assistantId)
    .eq("organization_id", orgId)
    .single();

  if (error || !assistant) {
    return { response: "", error: "Assistente nao encontrado" };
  }

  try {
    const systemPrompt = `${assistant.prompt}\n\nTom de conversa: ${assistant.tone}.\nVoce esta em modo de teste. Responda a mensagem do usuario de acordo com suas instrucoes.`;

    const result = await chatCompletion(
      systemPrompt,
      [{ role: "user", content: message }],
      { model: assistant.model || "gpt-4.1-mini" }
    );

    return { response: result };
  } catch (err) {
    return {
      response: "",
      error: err instanceof Error ? err.message : "Erro ao gerar resposta",
    };
  }
}
