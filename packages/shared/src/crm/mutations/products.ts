import type {
  OrgProduct,
  LeadProduct,
  CreateOrgProductInput,
  UpdateOrgProductInput,
  AddLeadProductInput,
  UpdateLeadProductInput,
} from "../types";
import type { CrmMutationContext } from "./context";
import { sanitizeMutationError } from "./errors";

export async function createOrgProduct(
  ctx: CrmMutationContext,
  input: CreateOrgProductInput,
): Promise<OrgProduct> {
  const { db, orgId } = ctx;
  const { data, error } = await db
    .from("org_products")
    .insert({
      organization_id: orgId,
      name: input.name,
      description: input.description ?? null,
      price: input.price,
      photo_url: input.photo_url ?? null,
      is_active: input.is_active ?? true,
    })
    .select("*")
    .single();

  if (error) throw sanitizeMutationError(error, "Erro ao criar produto");
  return data as unknown as OrgProduct;
}

export async function updateOrgProduct(
  ctx: CrmMutationContext,
  productId: string,
  input: UpdateOrgProductInput,
): Promise<void> {
  const { db, orgId } = ctx;
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined)        patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.price !== undefined)       patch.price = input.price;
  if (input.photo_url !== undefined)   patch.photo_url = input.photo_url;
  if (input.is_active !== undefined)   patch.is_active = input.is_active;
  const { error } = await db
    .from("org_products")
    .update(patch)
    .eq("id", productId)
    .eq("organization_id", orgId);

  if (error) throw sanitizeMutationError(error, "Erro ao atualizar produto");
}

export async function deleteOrgProduct(
  ctx: CrmMutationContext,
  productId: string,
): Promise<void> {
  const { db, orgId } = ctx;
  const { error } = await db
    .from("org_products")
    .delete()
    .eq("id", productId)
    .eq("organization_id", orgId);

  if (error) throw sanitizeMutationError(error, "Erro ao remover produto");
}

export async function addLeadProduct(
  ctx: CrmMutationContext,
  leadId: string,
  input: AddLeadProductInput,
): Promise<LeadProduct> {
  const { db, orgId } = ctx;

  // Valida que lead e produto pertencem a esta org — evita referência cross-org.
  const [leadCheck, prodCheck] = await Promise.all([
    db.from("leads").select("id").eq("id", leadId).eq("organization_id", orgId).maybeSingle(),
    db.from("org_products").select("id").eq("id", input.product_id).eq("organization_id", orgId).maybeSingle(),
  ]);
  if (!leadCheck.data) throw new Error("Lead não encontrado");
  if (!prodCheck.data) throw new Error("Produto não encontrado");

  const { data, error } = await db
    .from("lead_products")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      product_id: input.product_id,
      quantity: input.quantity,
      unit_price: input.unit_price,
      discount: input.discount ?? 0,
      notes: input.notes ?? null,
    })
    .select("*, org_products(*)")
    .single();

  if (error) throw sanitizeMutationError(error, "Erro ao adicionar produto ao lead");
  return data as unknown as LeadProduct;
}

export async function updateLeadProduct(
  ctx: CrmMutationContext,
  leadProductId: string,
  input: UpdateLeadProductInput,
): Promise<void> {
  const { db, orgId } = ctx;
  const patch: Record<string, unknown> = {};

  if (input.product_id !== undefined) {
    // Valida que o novo produto pertence a esta org.
    const { data: prodCheck } = await db
      .from("org_products")
      .select("id")
      .eq("id", input.product_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!prodCheck) throw new Error("Produto não encontrado");
    patch.product_id = input.product_id;
  }
  if (input.quantity !== undefined)   patch.quantity = input.quantity;
  if (input.unit_price !== undefined) patch.unit_price = input.unit_price;
  if (input.discount !== undefined)   patch.discount = input.discount;
  if (input.notes !== undefined)      patch.notes = input.notes;

  const { error } = await db
    .from("lead_products")
    .update(patch)
    .eq("id", leadProductId)
    .eq("organization_id", orgId);

  if (error) throw sanitizeMutationError(error, "Erro ao atualizar produto do lead");
}

export async function removeLeadProduct(
  ctx: CrmMutationContext,
  leadProductId: string,
): Promise<void> {
  const { db, orgId } = ctx;
  const { error } = await db
    .from("lead_products")
    .delete()
    .eq("id", leadProductId)
    .eq("organization_id", orgId);

  if (error) throw sanitizeMutationError(error, "Erro ao remover produto do lead");
}
