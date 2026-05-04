// CRM mutations — sanitizacao de erros do Supabase/PostgREST.
//
// Por que: actions throw `new Error(error.message)` direto vazam
// detalhes do schema (constraint names, table names, codigos PG)
// pro frontend, que costuma renderizar a mensagem em toast.error.
// Isso e ruim por 2 motivos:
//   1. Seguranca: revela o nome de constraints/tabelas/colunas que
//      ajudam atacantes a mapear o schema.
//   2. UX: "duplicate key value violates unique constraint
//      \"deal_loss_reasons_organization_id_label_key\"" e ilegivel
//      pro usuario final.
//
// Este helper mapeia codigos PostgreSQL conhecidos pra mensagens
// PT-BR amigaveis e o resto vira "Operacao falhou. Tente novamente."
// O detalhe original vai pro console.error pra debugging em prod.
//
// Uso:
//   const { error } = await db.from("x").insert(...);
//   if (error) throw sanitizeMutationError(error, "Erro ao criar X");
//
// Onde "Erro ao criar X" e o fallback caso o codigo nao mapeie.

interface SupabaseLikeError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

// Mapeia codigos PG conhecidos pra mensagens amigaveis. Lista
// curta proposital — so cobre os que o CRM realmente dispara.
//
// Referencia completa: https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_CODE_MESSAGES: Record<string, string> = {
  "23505": "Ja existe um registro com esses dados.", // unique_violation
  "23503": "Operacao bloqueada: existem registros relacionados.", // foreign_key_violation
  "23502": "Campo obrigatorio nao preenchido.", // not_null_violation
  "23514": "Valor invalido pra esse campo.", // check_violation
  "42501": "Permissao insuficiente pra essa operacao.", // insufficient_privilege (RLS)
  "42P01": "Recurso indisponivel no momento.", // undefined_table (schema nao migrado)
  "P0001": "Operacao bloqueada por uma regra do sistema.", // raise_exception (custom triggers)
  "57014": "A operacao demorou demais e foi cancelada.", // query_canceled (statement timeout)
};

export function sanitizeMutationError(
  error: SupabaseLikeError | unknown,
  fallback = "Operacao falhou. Tente novamente.",
): Error {
  if (!error || typeof error !== "object") {
    return new Error(fallback);
  }

  const supaErr = error as SupabaseLikeError;

  // Loga o erro cru no servidor pra debugging — esse log fica
  // visivel no Vercel/Logs Explorer mas NAO chega no cliente.
  // eslint-disable-next-line no-console
  console.error("[crm-mutation]", {
    code: supaErr.code,
    message: supaErr.message,
    details: supaErr.details,
    hint: supaErr.hint,
  });

  if (supaErr.code && PG_CODE_MESSAGES[supaErr.code]) {
    return new Error(PG_CODE_MESSAGES[supaErr.code]);
  }

  // Fallback heuristico pra codigos sem mapeamento mas com keywords
  // reconheciveis. Cobre erros do PostgREST sem code (ex: timeouts
  // do edge runtime).
  const lower = (supaErr.message ?? "").toLowerCase();
  if (lower.includes("duplicate key")) return new Error(PG_CODE_MESSAGES["23505"]);
  if (lower.includes("foreign key")) return new Error(PG_CODE_MESSAGES["23503"]);
  if (lower.includes("violates row-level security")) return new Error(PG_CODE_MESSAGES["42501"]);
  if (lower.includes("timeout")) return new Error(PG_CODE_MESSAGES["57014"]);

  return new Error(fallback);
}
