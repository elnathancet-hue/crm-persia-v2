"use server";

import { requireRole } from "@/lib/auth";
import type {
  OrgProduct,
  LeadProduct,
  CreateOrgProductInput,
  UpdateOrgProductInput,
  AddLeadProductInput,
  UpdateLeadProductInput,
} from "@persia/shared/crm";
import {
  listOrgProducts,
  listLeadProducts,
  createOrgProduct as createOrgProductShared,
  updateOrgProduct as updateOrgProductShared,
  deleteOrgProduct as deleteOrgProductShared,
  addLeadProduct as addLeadProductShared,
  updateLeadProduct as updateLeadProductShared,
  removeLeadProduct as removeLeadProductShared,
} from "@persia/shared/crm";

// ---------------------------------------------------------------
// Catálogo de produtos da org
// ---------------------------------------------------------------

export async function getOrgProducts(opts: { activeOnly?: boolean } = {}): Promise<OrgProduct[]> {
  const { supabase, orgId } = await requireRole("agent");
  return listOrgProducts({ db: supabase, orgId }, opts);
}

export async function createOrgProduct(input: CreateOrgProductInput): Promise<OrgProduct> {
  const { supabase, orgId } = await requireRole("agent");
  return createOrgProductShared({ db: supabase, orgId }, input);
}

export async function updateOrgProduct(
  productId: string,
  input: UpdateOrgProductInput,
): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  return updateOrgProductShared({ db: supabase, orgId }, productId, input);
}

export async function deleteOrgProduct(productId: string): Promise<void> {
  const { supabase, orgId } = await requireRole("admin");
  return deleteOrgProductShared({ db: supabase, orgId }, productId);
}

// ---------------------------------------------------------------
// Produtos vinculados a um lead
// ---------------------------------------------------------------

export async function getLeadProducts(leadId: string): Promise<LeadProduct[]> {
  const { supabase, orgId } = await requireRole("agent");
  return listLeadProducts({ db: supabase, orgId }, leadId);
}

export async function addLeadProduct(
  leadId: string,
  input: AddLeadProductInput,
): Promise<LeadProduct> {
  const { supabase, orgId } = await requireRole("agent");
  return addLeadProductShared({ db: supabase, orgId }, leadId, input);
}

export async function updateLeadProduct(
  leadProductId: string,
  input: UpdateLeadProductInput,
): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  return updateLeadProductShared({ db: supabase, orgId }, leadProductId, input);
}

export async function removeLeadProduct(leadProductId: string): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  return removeLeadProductShared({ db: supabase, orgId }, leadProductId);
}
