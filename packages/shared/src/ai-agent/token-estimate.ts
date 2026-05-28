// AI Agent — estimateTokens helper.
//
// Backlog #10 Auditoria (mai/2026): rodada 8 #3.
//
// O knowledge-injector decidia se ativava modo 'full' por BYTES (30KB).
// Mas o prompt eh consumido pela OpenAI em TOKENS, e em portugues
// 1 token ~= 3 caracteres. 30KB ~= 10k tokens (nao 7.5k como o threshold
// implicitamente sugeria). Combinado com tools schema + system_prompt
// + instructions, o auto mode podia explodir a janela de gpt-4o-mini
// (~8k tokens em pratica) sem aviso.
//
// Solucao: helper compartilhado que estima tokens a partir de chars.
// Por que nao usar tiktoken-node ou @dqbd/tiktoken?
//   - tiktoken WASM tem ~3MB de bundle, sobe cold-start serverless
//   - Roda dentro de loops de chunks (N tokens.encode) — overhead
//     real em prod
//   - A heuristica chars/3 erra em ~10-15% pra PT-BR/EN, o que ainda
//     fica dentro da margem de seguranca do threshold (6000 tokens com
//     budget OpenAI de 8000 deixa folga)
//
// Quando trocar: se aparecer caso real onde a heuristica decide errado
// (full block estoura janela ou rag block teve doc pequeno), considerar
// tiktoken sob feature flag.

/**
 * Estimativa de tokens a partir de char count. Heuristica simples:
 *   - PT-BR / EN com mistura de palavras curtas e longas: ~3 chars/token
 *   - Texto puramente ASCII curto (ex: numeros, codigo): ~4 chars/token
 *
 * Usamos divisor 3 (conservador — superestima ligeiramente em texto
 * curto) pra dar margem de seguranca no threshold. Sub-estimar e pior
 * que super-estimar: sub-estimar deixa janela estourar.
 */
export const CHARS_PER_TOKEN_PT_BR = 3;

/**
 * Estima quantos tokens uma string ocuparia no prompt. Usa
 * Math.ceil pra arredondar pra cima (conservador).
 *
 * Aceita undefined/null/empty graciosamente (retorna 0).
 *
 * Nao usa tiktoken — ver comentario do header sobre trade-off.
 */
export function estimateTokens(
  text: string | null | undefined,
): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_PT_BR);
}

/**
 * Estima tokens de um array de strings (ex: chunks de um doc). Soma
 * cada chunk individualmente — preserva precisao melhor que concatenar
 * + estimar uma vez (diferenca minima na pratica).
 */
export function estimateTokensFromTexts(
  texts: ReadonlyArray<string | null | undefined>,
): number {
  let total = 0;
  for (const t of texts) {
    total += estimateTokens(t);
  }
  return total;
}
