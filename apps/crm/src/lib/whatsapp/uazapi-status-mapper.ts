// Bug B fix (mai/2026): mapeia UAZAPI message status codes pro
// enum CHECK constraint da tabela messages (`status` column).
//
// UAZAPI usa nomenclatura herdada do baileys/whatsapp-web.js. Valores
// vistos no campo `body.message.status` do evento `messages_update`:
//
//   PENDING       — msg enviada da API mas ainda não confirmada (rara)
//   SERVER_ACK    — entregue ao servidor WhatsApp (= "sent" no DB)
//   DELIVERY_ACK  — entregue ao device do destinatário (= "delivered")
//   READ          — destinatário leu (✓✓ azul = "read")
//   PLAYED        — áudio/video play (também conta como "read")
//   READ_SELF     — variação do read (sincronização multi-device)
//   ERROR         — falha do provider (= "failed")
//
// Há variações de capitalização entre versões UAZAPI (`DELIVERY_ACK` vs
// `delivery_ack`). Normalizamos pra lowercase antes do match.
//
// Status NÃO mapeado: retorna null. Caller deve no-op (não atualiza DB)
// e logar pra detectar valores novos que UAZAPI introduzir.

import type { Database } from "@persia/shared/database";

/** Valores aceitos no CHECK constraint da coluna messages.status. */
export type MessageStatus = NonNullable<
  Database["public"]["Tables"]["messages"]["Row"]["status"]
>;

const UAZAPI_TO_DB: Readonly<Record<string, MessageStatus>> = {
  // Sent — entregue ao servidor WhatsApp
  sent: "sent",
  server_ack: "sent",
  // Delivered — entregue ao device do destinatário
  delivered: "delivered",
  delivery_ack: "delivered",
  // Read — destinatário visualizou
  read: "read",
  played: "read",
  read_self: "read",
  // Failed — provider rejeitou
  error: "failed",
  failed: "failed",
};

/**
 * Mapeia status string do payload UAZAPI `messages_update` pro valor
 * do enum interno do DB. Retorna null se o valor é desconhecido (caller
 * deve logar + ignorar, NÃO atualizar DB com valor inválido).
 *
 * Tolera:
 *  - Variações de case (DELIVERY_ACK == delivery_ack == Delivery_Ack)
 *  - Trim de whitespace
 *  - String vazia → null
 */
export function mapUazapiStatus(raw: unknown): MessageStatus | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  return UAZAPI_TO_DB[normalized] ?? null;
}
