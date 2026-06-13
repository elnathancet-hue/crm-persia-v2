"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

/** Bloqueia URLs SSRF: localhost, IPs privados e loopback. */
function validateWebhookUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL inválida");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("URL deve usar http ou https");
  }
  const hostname = parsed.hostname.toLowerCase();
  // Bloqueia localhost e variantes
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    throw new Error("URL não pode apontar para localhost");
  }
  // Bloqueia IPs privados (RFC 1918) e link-local
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 127
    ) {
      throw new Error("URL não pode apontar para rede privada");
    }
  }
}

export async function getWebhooks() {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("webhooks")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createWebhook(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const eventsRaw = formData.get("events") as string;
  const events = eventsRaw
    ? eventsRaw
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean)
    : [];

  const direction = formData.get("direction") as string;
  const urlRaw = (formData.get("url") as string) || "";
  if (direction === "outbound") {
    if (!urlRaw.trim()) throw new Error("URL é obrigatória para webhooks de saída");
    validateWebhookUrl(urlRaw.trim());
  }
  const token =
    direction === "inbound"
      ? crypto.randomUUID().replace(/-/g, "")
      : null;

  const { data, error } = await supabase
    .from("webhooks")
    .insert({
      organization_id: orgId,
      name: formData.get("name") as string,
      direction: direction || "outbound",
      url: urlRaw.trim() || null,
      token,
      events,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/settings/webhooks");
  return data;
}

export async function toggleWebhookActive(id: string, isActive: boolean) {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase
    .from("webhooks")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/webhooks");
}

export async function deleteWebhook(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase.from("webhooks").delete().eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/webhooks");
}
