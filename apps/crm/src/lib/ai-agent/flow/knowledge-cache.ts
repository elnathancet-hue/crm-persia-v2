import "server-only";

// Backlog #2 Auditoria (mai/2026) — endereca rodada 6 #5 + rodada 8 #1
// do POST_CODEX_AUDIT_AGENT_FLOW_353.md.
//
// Antes, `buildKnowledgeBlock` em modo 'full' carregava TODOS os chunks
// de `agent_knowledge_chunks` + concatenava em string a CADA turn de
// CADA conversa. Doc de 150KB × 10 turns × 50 conversas/dia = 75MB de
// tokens redundantes pra OpenAI por dia. PR-2 ja aplicou hard-cap 50KB
// no full mode pra limitar o pior caso, mas o trabalho redundante
// continuava.
//
// Este cache armazena o bloco formatado em memoria por process. Chave
// composta:
//   - "full:<config_id>"  → bloco completo do modo full
//
// Invalidacao automatica via `sources_hash` derivado de
// MAX(updated_at) + COUNT(*) em agent_knowledge_sources. Sempre que
// uma source nova e indexed (indexing_status -> completed), MAX(updated_at)
// muda, hash muda, cache miss → re-carrega.
//
// Trade-offs aceitos pra V1:
//   - Cache LOCAL ao process. Vercel/EasyPanel com multi-instance =
//     cada instance tem seu cache. Sem coordenacao, mas cada instance
//     ainda economiza dentro da sua janela TTL.
//   - TTL longo (15min) porque sources_hash check ja invalida automaticamente.
//     TTL existe so como safety net pra liberar memoria de configs
//     inativos.
//   - Sem limite explicito de memoria. Cada bloco e ate 50KB (PR-2 cap)
//     e orgs tipicas tem ate ~20 agents ativos. ~1MB max por instance —
//     desprezivel. Se virar problema, adicionar LRU.

interface CachedBlock {
  block: string | null;
  sources_hash: string;
  cached_at: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15min

const cache = new Map<string, CachedBlock>();

/**
 * Lookup de cache. Retorna o bloco se valido (hash bate E age < TTL),
 * null caso contrario. Caller deve recarregar e chamar `setCachedBlock`.
 */
export function getCachedBlock(
  key: string,
  expectedSourcesHash: string,
  now: number = Date.now(),
): string | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined; // miss completo

  if (entry.sources_hash !== expectedSourcesHash) {
    // Sources mudaram desde o cache — invalida e retorna miss.
    cache.delete(key);
    return undefined;
  }

  if (now - entry.cached_at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }

  // Hit valido. Pode ser null (sem chunks) — caller distingue de undefined.
  return entry.block;
}

/**
 * Grava bloco no cache. Caller passa o bloco computado + sources_hash
 * usado pra resolve-lo. Sobrescreve entrada anterior se existir.
 */
export function setCachedBlock(
  key: string,
  block: string | null,
  sourcesHash: string,
  now: number = Date.now(),
): void {
  cache.set(key, {
    block,
    sources_hash: sourcesHash,
    cached_at: now,
  });
}

/**
 * Limpa o cache inteiro. Usado em testes pra isolar cenarios; em
 * producao nao deveria ser chamado (TTL + sources_hash gerenciam).
 */
export function clearKnowledgeCache(): void {
  cache.clear();
}

/**
 * Inspector pra testes — retorna size atual da cache.
 */
export function getKnowledgeCacheSize(): number {
  return cache.size;
}
