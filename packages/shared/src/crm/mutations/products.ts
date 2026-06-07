import type {
  OrgProduct,
  LeadProduct,
  CreateOrgProductInput,
  UpdateOrgProductInput,
  AddLeadProductInput,
  UpdateLeadProductInput,
} from "../types";
import type { CrmMutationContext } from "./context";

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

  if (error) throw new Error(error.message);
  return data as unknown as OrgProduct;
}

export async function updateOrgProduct(
  ctx: CrmMutationContext,
  productId: string,
  input: UpdateOrgProductInput,
): Promise<void> {
  const { db, orgId } = ctx;
  const { error } = await db
    .from("org_products")
    .update(input)
    .eq("id", productId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
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

  if (error) throw new Error(error.message);
}

export async function addLeadProduct(
  ctx: CrmMutationContext,
  leadId: string,
  input: AddLeadProductInput,
): Promise<LeadProduct> {
  const { db, orgId } = ctx;
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

  if (error) throw new Error(error.message);
  return data as unknown as LeadProduct;
}

export async function updateLeadProduct(
  ctx: CrmMutationContext,
  leadProductId: string,
  input: UpdateLeadProductInput,
): Promise<void> {
  const { db, orgId } = ctx;
  const { error } = await db
    .from("lead_products")
    .update(input)
    .eq("id", leadProductId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
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

  if (error) throw new Error(error.message);
}
