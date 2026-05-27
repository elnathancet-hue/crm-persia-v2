// Backlog #12 Auditoria (mai/2026) — endereca rodada 4 #media do
// POST_CODEX_AUDIT_AGENT_FLOW_353.md.
//
// Antes, `{{lead.name}}` era interpretado apenas em
// send_whatsapp_message (via funcao interna do runner.ts).
// set_lead_custom_field tinha UI que prometia `{{lead.name}}` mas o
// handler armazenava literal — cliente via `{{lead.name}}` salvo
// em vez do nome do lead.
//
// Este modulo centraliza a interpolacao + helper pra carregar lead.
// Usado por:
//   - runner.ts (executeSendWhatsappMessageAction)
//   - tools/set-lead-custom-field.ts
//
// V1 suporta `{{lead.name}}`, `{{lead.phone}}`, `{{lead.email}}`.
// Outras chaves (`{{lead.foo}}`) sao silenciosamente removidas
// (substituem por string vazia). Decisao: melhor perder uma variavel
// nao definida do que mostrar `{{lead.foo}}` literal pro lead.

import "server-only";

import type { AgentDb } from "../db";

export interface LeadForInterpolation {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

const LEAD_PLACEHOLDER_RE = /\{\{lead\.(\w+)\}\}/g;

/**
 * Substitui `{{lead.X}}` por lead[X] no template. Chaves nao reconhecidas
 * viram string vazia (silenciosa). Use lead vazio (`{}`) pra remover
 * todos os placeholders.
 */
export function interpolateLeadPlaceholders(
  template: string,
  lead: LeadForInterpolation,
): string {
  return template.replace(LEAD_PLACEHOLDER_RE, (_, key) => {
    const value = (lead as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  });
}

/**
 * Verifica se o template contem algum placeholder reconhecido.
 * Usado pra short-circuit (evitar query no DB quando nao ha o que
 * interpolar).
 */
export function hasLeadPlaceholders(template: string): boolean {
  return LEAD_PLACEHOLDER_RE.test(template);
}

/**
 * Carrega campos minimos do lead pra interpolacao. Retorna `{}` se
 * leadId for null/undefined OU lead nao existir (defensive — caller
 * passa o objeto pra interpolateLeadPlaceholders mesmo assim, e os
 * placeholders viram vazios).
 */
export async function loadLeadForInterpolation(
  db: AgentDb,
  orgId: string,
  leadId: string | null | undefined,
): Promise<LeadForInterpolation> {
  if (!leadId) return {};
  const { data } = await db
    .from("leads")
    .select("name, phone, email")
    .eq("organization_id", orgId)
    .eq("id", leadId)
    .maybeSingle();
  return (data as LeadForInterpolation | null) ?? {};
}
