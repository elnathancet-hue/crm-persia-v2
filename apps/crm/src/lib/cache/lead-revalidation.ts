"use server";

// PR-K LEAD-SYNC: helper centralizado pra invalidar caches do Lead
// no Next.js App Router.
//
// PROBLEMA RESOLVIDO:
// Antes deste PR, mutacoes de lead em diferentes caminhos chamavam
// `revalidatePath` de forma inconsistente:
//   - leads.ts: chamava /leads + /crm + /leads/:id (correto)
//   - /api/crm route (n8n): nao chamava nada (gap critico)
//   - incoming-pipeline.ts (webhook UAZAPI): nao chamava nada
//   - agenda/public.ts (booking): nao chamava nada
//   - crm.ts updateDealStage: so /crm (Tab Leads ficava desync)
//   - custom-fields.ts: so /leads/:id (lista nao reflete)
//
// Resultado: lead aparecia no banco, mas tab Leads nao mostrava ate
// o user navegar pra outra rota e voltar (F5 manual).
//
// SOLUCAO:
// 1 helper, 1 contrato, todos os call sites importam. Quando o
// schema de rotas mudar (ex: adicionar /leads-stats, renomear /leads
// pra /contacts), basta editar este arquivo — todos os call sites
// herdam.
//
// LIMITACAO CONSCIENTE:
// `revalidatePath` invalida cache server-side, mas NAO forca re-fetch
// no client. User PARADO na tab Leads quando webhook cria lead novo
// nao ve a mudanca ate proxima navegacao. Pra "ao vivo de verdade",
// precisa Realtime Supabase (PR-O futuro). Este PR resolve 95% dos
// casos: navegacao + acoes via UI.
//
// CARACTERISTICAS:
//   - Idempotente: pode ser chamado N vezes sem efeito colateral
//   - Tolerante a falha: try/catch interno — NUNCA quebra o caller
//     (especialmente critico em webhook UAZAPI que nao pode falhar)
//   - Server Action: pode ser importado em API routes E em outras
//     server actions

import { revalidatePath } from "next/cache";

/**
 * Invalida caches relacionados a um lead.
 *
 * Paths invalidados:
 *   - "/crm" — hub com 5 tabs (Pipeline, Leads, Segmentação, Tags,
 *     Atividades). Qualquer mudanca em lead afeta multiplas tabs
 *     simultaneamente, invalidar a rota inteira e mais simples e
 *     eficiente que invalidar cada tab.
 *   - "/leads" — rota standalone (redirect pra /crm?tab=leads).
 *     Preserva bookmarks externos.
 *   - "/leads/[id]" — pagina de detalhe individual (so se leadId
 *     for fornecido).
 *
 * Uso:
 *   await revalidateLeadCaches();          // invalida hub + lista
 *   await revalidateLeadCaches(leadId);    // + detalhe individual
 *   await revalidateLeadCaches(null);      // mesmo que sem args
 */
export async function revalidateLeadCaches(leadId?: string | null) {
  try {
    revalidatePath("/crm");
    revalidatePath("/leads");
    if (leadId) revalidatePath(`/leads/${leadId}`);
  } catch (err) {
    // Falha de revalidate NUNCA pode quebrar o caller. Especialmente
    // critico em webhooks UAZAPI: se revalidatePath falhar (ex: bug
    // do Next.js, contexto invalido), a mensagem ainda precisa
    // entrar no DB e gerar conversation. Loga + segue silenciosamente.
    console.error("[revalidateLeadCaches] failed:", err);
  }
}

/**
 * Conveniencia: invalida caches de chat tambem (alem do lead).
 * Usar quando uma mutacao de lead afeta lista de conversas
 * (ex: nova conversa criada via "Abrir conversa" do card Kanban,
 * ou conversation.assigned_to mudou).
 */
export async function revalidateLeadAndChatCaches(leadId?: string | null) {
  await revalidateLeadCaches(leadId);
  try {
    revalidatePath("/chat");
  } catch (err) {
    console.error("[revalidateLeadAndChatCaches /chat] failed:", err);
  }
}
