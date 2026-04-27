"use server";

// Catalogo de produtos do org + vinculo lead<->produto. Suporta o
// drawer "Informacoes do lead" tab Produtos (Fase 4 da reformulacao
// do /crm).
//
// Cast `untyped()` pra contornar Database type desatualizado — as
// tabelas products/lead_products sao novas (migration 031) e o gerador
// de tipos ainda nao foi rerodado. Org-scoping garantido via .eq() +
// RLS. Mesmo padrao usado em apps/crm/src/actions/ai-agent/followups.ts.

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type {
  LeadProductWithProduct,
  Product,
} from "@persia/shared/crm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function untyped(client: unknown): { from: (t: string) => any } {
  return client as { from: (t: string) => any };
}

// ============================================================
// PRODUCTS — catalogo
// ============================================================

export async function getProducts(): Promise<Product[]> {
  const { supabase, orgId } = await requireRole("agent");
  const { data, error } = await untyped(supabase)
    .from("products")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Product[];
}

export async function createProduct(input: {
  name: string;
  description?: string | null;
  price?: number;
}): Promise<Product> {
  const { supabase, orgId } = await requireRole("agent");
  const { data, error } = await untyped(supabase)
    .from("products")
    .insert({
      organization_id: orgId,
      name: input.name,
      description: input.description ?? null,
      price: input.price ?? 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Produto nao foi criado");
  revalidatePath("/leads");
  revalidatePath("/crm");
  return data as Product;
}

export async function updateProduct(
  productId: string,
  input: {
    name?: string;
    description?: string | null;
    price?: number;
    is_active?: boolean;
  },
): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined)
    updateData.description = input.description;
  if (input.price !== undefined) updateData.price = input.price;
  if (input.is_active !== undefined) updateData.is_active = input.is_active;

  const { error } = await untyped(supabase)
    .from("products")
    .update(updateData)
    .eq("id", productId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads");
  revalidatePath("/crm");
}

export async function deleteProduct(productId: string): Promise<void> {
  const { supabase, orgId } = await requireRole("admin");
  const { error } = await untyped(supabase)
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads");
  revalidatePath("/crm");
}

// ============================================================
// LEAD_PRODUCTS — produtos vinculados a um lead
// ============================================================

export async function getLeadProducts(
  leadId: string,
): Promise<LeadProductWithProduct[]> {
  const { supabase, orgId } = await requireRole("agent");
  const { data, error } = await untyped(supabase)
    .from("lead_products")
    .select("*, products(id, name, description)")
    .eq("lead_id", leadId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as LeadProductWithProduct[];
}

export async function addProductToLead(input: {
  lead_id: string;
  product_id: string;
  quantity?: number;
  unit_price?: number;
  notes?: string | null;
}): Promise<LeadProductWithProduct> {
  const { supabase, orgId } = await requireRole("agent");

  // Valida ownership de lead e produto.
  const { data: lead } = await untyped(supabase)
    .from("leads")
    .select("id")
    .eq("id", input.lead_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) throw new Error("Lead nao encontrado nesta organizacao");

  const { data: product } = await untyped(supabase)
    .from("products")
    .select("id, price")
    .eq("id", input.product_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!product) throw new Error("Produto nao encontrado nesta organizacao");

  // Snapshot de unit_price: usa o valor passado OU o preco atual do produto.
  const unitPrice =
    typeof input.unit_price === "number"
      ? input.unit_price
      : Number((product as { price: number | null }).price ?? 0);

  const { data, error } = await untyped(supabase)
    .from("lead_products")
    .insert({
      organization_id: orgId,
      lead_id: input.lead_id,
      product_id: input.product_id,
      quantity: input.quantity ?? 1,
      unit_price: unitPrice,
      notes: input.notes ?? null,
    })
    .select("*, products(id, name, description)")
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Falha ao vincular produto");
  revalidatePath(`/leads/${input.lead_id}`);
  revalidatePath("/crm");
  return data as LeadProductWithProduct;
}

export async function updateLeadProduct(
  leadProductId: string,
  input: { quantity?: number; unit_price?: number; notes?: string | null },
): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  const updateData: Record<string, unknown> = {};
  if (input.quantity !== undefined) updateData.quantity = input.quantity;
  if (input.unit_price !== undefined) updateData.unit_price = input.unit_price;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (Object.keys(updateData).length === 0) return;

  const { error } = await untyped(supabase)
    .from("lead_products")
    .update(updateData)
    .eq("id", leadProductId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads");
  revalidatePath("/crm");
}

export async function removeProductFromLead(
  leadProductId: string,
): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  const { error } = await untyped(supabase)
    .from("lead_products")
    .delete()
    .eq("id", leadProductId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads");
  revalidatePath("/crm");
}
