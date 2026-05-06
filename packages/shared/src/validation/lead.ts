// PR-A LEADFIX — Schemas Zod do dominio Lead.
//
// FILOSOFIA:
//   - Validar + NORMALIZAR num so passo. Quem usa o output ja recebe
//     dado limpo (phone E.164, email trimmed lowercase, etc).
//   - Mensagens em PT-BR.
//   - Tolerante a entrada suja (trim, strip non-digits do phone, etc).
//   - Regras minimas, nao paranoicas. CPF valido com digito verificador
//     mas aceita formato com OU sem mascara.

import { z } from "zod";

// ----------------------------------------------------------------
// Phone — formato brasileiro normalizado pra E.164
// ----------------------------------------------------------------
//
// Aceita:
//   "11987654321" (10 ou 11 digitos)
//   "(11) 98765-4321"
//   "+55 11 98765-4321"
//   "5511987654321"
//
// Saida: "+5511987654321" (E.164 sempre, sem espaco)
//
// Regra: se vier sem DDI 55 mas tiver 10-11 digitos, prepende 55.
// Se vier com DDI diferente (ex: +1, +351), aceita E.164 raw.

const PHONE_MIN_DIGITS = 10; // 10 = fixo (11 3322-4455), 11 = celular (11 98765-4321)
const PHONE_MAX_DIGITS = 15; // E.164 max teorico

export const phoneBR = z
  .string({ message: "Telefone obrigatorio" })
  .trim()
  .min(1, "Telefone obrigatorio")
  .transform((raw) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 0) return "";
    // Ja vem com 55 DDI? mantem
    if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
      return `+${digits}`;
    }
    // 10 ou 11 digitos? assume BR, prepende 55
    if (digits.length === 10 || digits.length === 11) {
      return `+55${digits}`;
    }
    // Outros casos: aceita como E.164 raw (intl)
    return `+${digits}`;
  })
  .refine(
    (val) => {
      const digits = val.replace(/\D/g, "");
      return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
    },
    { message: "Telefone deve ter entre 10 e 15 digitos" },
  );

/** Phone opcional — undefined/empty pass through, formato valido se preenchido. */
export const phoneBROptional = z
  .string()
  .trim()
  .optional()
  .transform((raw) => {
    if (!raw || raw.length === 0) return undefined;
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 0) return undefined;
    if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
      return `+${digits}`;
    }
    if (digits.length === 10 || digits.length === 11) {
      return `+55${digits}`;
    }
    return `+${digits}`;
  })
  .refine(
    (val) => {
      if (val === undefined) return true;
      const digits = val.replace(/\D/g, "");
      return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
    },
    { message: "Telefone deve ter entre 10 e 15 digitos" },
  );

// ----------------------------------------------------------------
// Email — normaliza pra lowercase trimmed
// ----------------------------------------------------------------

export const emailSchema = z
  .string({ message: "Email invalido" })
  .trim()
  .toLowerCase()
  .email("Email invalido");

export const emailOptional = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine(
    (v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    { message: "Email invalido" },
  );

// ----------------------------------------------------------------
// CPF / CNPJ — valida digito verificador
// ----------------------------------------------------------------

function validateCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // todos iguais

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]!, 10) * (10 - i);
  let check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  if (check !== parseInt(digits[9]!, 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]!, 10) * (11 - i);
  check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  return check === parseInt(digits[10]!, 10);
}

function validateCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calc = (slice: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += parseInt(slice[i]!, 10) * weights[i]!;
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(digits.slice(0, 12), w1);
  if (d1 !== parseInt(digits[12]!, 10)) return false;
  const d2 = calc(digits.slice(0, 13), w2);
  return d2 === parseInt(digits[13]!, 10);
}

export const cpfCnpjSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v.replace(/\D/g, "") : undefined))
  .refine(
    (v) => {
      if (v === undefined) return true;
      if (v.length === 11) return validateCPF(v);
      if (v.length === 14) return validateCNPJ(v);
      return false;
    },
    { message: "CPF ou CNPJ invalido" },
  );

// ----------------------------------------------------------------
// Lead name
// ----------------------------------------------------------------

export const leadNameSchema = z
  .string({ message: "Nome obrigatorio" })
  .trim()
  .min(2, "Nome muito curto (minimo 2 caracteres)")
  .max(120, "Nome muito longo (maximo 120 caracteres)");

export const leadNameOptional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length >= 2 ? v : undefined));

// ----------------------------------------------------------------
// Lead create — schema composto
// ----------------------------------------------------------------
//
// Regra de negocio: phone OU email obrigatorio. Lead sem canal de
// contato e inutil pra atendimento comercial.

export const leadCreateSchema = z
  .object({
    name: leadNameOptional,
    phone: phoneBROptional,
    email: emailOptional,
    document: cpfCnpjSchema,
    source: z.string().trim().max(60).optional(),
    status: z.string().trim().max(40).optional(),
    channel: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (data) => Boolean(data.phone) || Boolean(data.email),
    {
      message: "Lead precisa de pelo menos um canal de contato (telefone ou email)",
      path: ["phone"], // erro aparece no campo phone (mais comum)
    },
  );

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

// ----------------------------------------------------------------
// Lead update — todos campos opcionais, mas se vier phone/email,
// validar formato. Nao requer phone OU email (update parcial pode
// nao tocar contato).
// ----------------------------------------------------------------

export const leadUpdateSchema = z.object({
  name: leadNameOptional,
  phone: phoneBROptional,
  email: emailOptional,
  document: cpfCnpjSchema,
  source: z.string().trim().max(60).optional(),
  status: z.string().trim().max(40).optional(),
  channel: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  score: z.number().int().min(0).max(100).optional(),
});

export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
