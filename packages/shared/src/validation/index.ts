// PR-A LEADFIX — Schemas Zod centralizados pra validacao de Lead
// em todos os caminhos (forms, server actions, webhook, API n8n,
// booking publico). Fonte unica de verdade.
//
// Padrao:
//   - Cada schema retorna o valor NORMALIZADO (phone E.164, email
//     lowercase trimmed, etc). Nao apenas valida — transforma.
//   - Mensagens de erro em PT-BR, prontas pra UI.
//   - Schemas compostos no final (leadCreateSchema) reutilizam os
//     primitivos.

export {
  phoneBR,
  phoneBROptional,
  emailSchema,
  emailOptional,
  cpfCnpjSchema,
  leadNameSchema,
  leadNameOptional,
  leadCreateSchema,
  leadUpdateSchema,
  type LeadCreateInput,
  type LeadUpdateInput,
} from "./lead";
