// types-internal.ts — tipos internos de infraestrutura usados pelo módulo de campanhas.
// Não exportar via index público — são detalhes de implementação.

/**
 * Subconjunto mínimo do cliente Supabase tipado que o audience-resolver
 * e o worker precisam. Usar `supabase as never` no caller para satisfazer
 * sem acionar TS2589 ("excessively deep type instantiation").
 */
export interface MinimalDb {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => unknown;
    };
  };
}
