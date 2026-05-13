/**
 * Contrato de retorno padrão para Server Actions do CRM Persia v2.
 *
 * Toda Server Action que muda estado retorna ActionResult. Nunca usa
 * `throw new Error(...)` para fluxo esperado (validação, auth, conflito).
 * `throw` fica reservado pra erros realmente inesperados (DB offline,
 * bug de código) e o framework Next.js trata como 500.
 *
 * Referências:
 *   - packages/ui/docs/patterns.md (Pattern #3)
 *   - memory/project_architecture_layers.md (Padrões obrigatórios)
 */

export type ActionResult<TData = unknown> =
  | { data: TData; error?: undefined }
  | { error: string; data?: undefined }
  | void;

/** Helper pra checar se ActionResult é erro sem ambigüidade. */
export function isActionError<T>(
  result: ActionResult<T>,
): result is { error: string } {
  return Boolean(result) && typeof (result as { error?: string }).error === "string";
}

/** Helper pra extrair data de ActionResult (retorna undefined se erro/void). */
export function actionData<T>(result: ActionResult<T>): T | undefined {
  if (result && typeof result === "object" && "data" in result) {
    return result.data;
  }
  return undefined;
}
