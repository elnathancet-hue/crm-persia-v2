# 05 — Knowledge inject

> "Documentos da base" do AI Agent. 3 modos, cache, threshold em tokens, RAG.

## TL;DR

`buildKnowledgeBlock(db, orgId, configId, queryText)` retorna texto formatado pra injetar
no system prompt do LLM. 3 modos configuráveis via `agent_configs.knowledge_mode`:

- **`full`**: concatena TODOS os chunks. Funciona pra docs pequenos.
- **`rag`**: top-k retrieval via Voyage embedding + pgvector. Pra docs grandes.
- **`auto`** (default em casos novos; legado `full`): decide por tamanho estimado em tokens.

Cache por `(config_id, sources_hash)`. Hard-cap 16k tokens força fallback pra `rag` mesmo
em `full` manual.

## Arquivos

```
apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts   # core
apps/crm/src/lib/ai-agent/flow/knowledge-cache.ts      # in-memory TTL cache
apps/crm/src/lib/ai-agent/rag/voyage-client.ts         # Voyage AI client
apps/crm/src/lib/ai-agent/rag/retriever.ts             # top-k retrieval
apps/crm/src/lib/ai-agent/rag/chunker.ts               # chunking
apps/crm/src/lib/ai-agent/rag/indexer.ts               # background indexing
packages/shared/src/ai-agent/token-estimate.ts         # estimateTokens helper
```

## Constantes (`knowledge-injector.ts`)

```ts
const AUTO_FULL_TOKEN_THRESHOLD = 6000;   // PR #371: era 30KB bytes
const FULL_MODE_HARD_CAP_TOKENS = 16000;  // PR #371: era 50KB bytes
const RAG_TOP_K = 3;
```

PT-BR ~3 chars/token. 6000 tokens = ~18KB de conteúdo. 16000 = ~48KB. Janela do
gpt-4o-mini é ~8k tokens em prod somando system_prompt (~1-2k) + tools schema (~3-5k) +
history (~500-1500) — sobra pouco pra knowledge. Por isso threshold conservador.

## Modos

### `full`

Concatena todos os chunks `indexed` do agente.

```ts
async function buildFullModeBlock(db, orgId, configId): Promise<string | null> {
  // 1. Cache lookup com sources_hash check
  const cacheKey = `full:${orgId}:${configId}`;
  const sourcesHash = await computeFullModeSourcesHash(db, orgId, configId);
  if (sourcesHash !== null) {
    const cached = getCachedBlock(cacheKey, sourcesHash);
    if (cached !== undefined) return cached;
  }

  // 2. Load chunks completed, ordenados por source+chunk_index
  const { data } = await db.from("agent_knowledge_chunks")
    .select("content, chunk_index, source:agent_knowledge_sources!inner(title, indexing_status, agent_config_id, organization_id)")
    .eq("source.organization_id", orgId)
    .eq("source.agent_config_id", configId)
    .eq("source.indexing_status", "completed")
    .order("source_id", { ascending: true })
    .order("chunk_index", { ascending: true });

  if (!data || data.length === 0) {
    if (sourcesHash !== null) setCachedBlock(cacheKey, null, sourcesHash);
    return null;
  }

  // 3. Agrupa por source pra rotular cada doc + render
  // 4. Cacheia + retorna
}
```

Output template:

```
BASE DE CONHECIMENTO
Use as informações abaixo como fonte de verdade ao responder perguntas do lead.
Se o lead perguntar algo que NÃO está aqui, diga que não tem essa informação.

### FAQ
Atendemos zona sul.
Taxa de 6%.

### Proposta
Item 1: descritivo.
Item 2: descritivo.
```

Section title = `agent_knowledge_sources.title`. Quando título é duplicado entre sources,
agrupa sob o mesmo. Quando `null`, usa "Documento".

### `rag`

Top-k retrieval via Voyage embedding.

```ts
async function buildRagModeBlock(orgId, configId, queryText, db): Promise<string | null> {
  const result = await retrieveWithAttempt({
    organization_id: orgId,
    config_id: configId,
    query_text: queryText,
    top_k: RAG_TOP_K,
    audit: false,
  }, db);

  if (!result.success || result.hits.length === 0) return null;

  // Render top-k como "Trecho 1", "Trecho 2", etc
  // Inclui source_title quando disponível
}
```

Output template:

```
TRECHOS RELEVANTES (BASE DE CONHECIMENTO)
Use as informações abaixo como fonte de verdade. São os trechos relevantes pra essa pergunta:

### Proposta — Trecho 1
Item 1: descritivo.

### Proposta — Trecho 2
Item 2: descritivo.
```

`RAG_DISTANCE_CEILING = 0.75` em `apps/crm/src/lib/ai-agent/rag/retriever.ts` — chunks
com distância acima são filtrados (irrelevantes).

### `auto`

Roteador entre full e rag baseado em token count estimado.

```ts
async function resolveAutoMode(db, orgId, configId): Promise<"full" | "rag" | "empty"> {
  const totalTokens = await measureKnowledgeTokens(db, orgId, configId);
  if (totalTokens === 0) return "empty";
  return totalTokens < AUTO_FULL_TOKEN_THRESHOLD ? "full" : "rag";
}
```

`measureKnowledgeTokens` soma `estimateTokens(chunk.content)` de todos os chunks
completed. Não é exato (heurística chars/3 PT-BR) mas suficiente pra decisão binária.

### Hard-cap unificado (PR #371)

Aplica em TODOS os modos quando resolve pra `full`:

```ts
if (mode === "full") {
  const totalTokens = await measureKnowledgeTokens(db, orgId, configId);
  if (totalTokens === 0) return null;
  if (totalTokens > FULL_MODE_HARD_CAP_TOKENS) {
    logError("ai_agent_knowledge_full_exceeded_cap", {
      organization_id, config_id, total_tokens, cap_tokens: FULL_MODE_HARD_CAP_TOKENS,
      fallback_mode: "rag",
    });
    mode = "rag";  // fallback automático
  }
}
```

Cliente forçar `full` manualmente em UI não bypassa. Se quiser, deve subir doc menor.

## Cache (`knowledge-cache.ts`)

In-memory por instance. TTL 5min (`CACHE_TTL_MS`). Invalidação dupla:

1. **`sources_hash` check** (primário): `md5(MAX(updated_at) || COUNT(*))` das sources
   completed. Mudou hash → cache miss + reload + cacheia com hash novo.
2. **TTL fallback** (secundário): expira em 5min mesmo se hash não mudou (proteção
   contra "fantasma" de cache cross-instance).

Helpers:

- `getCachedBlock(key, sourcesHash)`: retorna value cached OU `undefined` se miss.
- `setCachedBlock(key, value, sourcesHash)`: armazena (value pode ser `null` = "sem chunks").
- `clearKnowledgeCache()`: usado em testes pra reset entre cases.

Sem cross-instance sync — cada Next.js process tem cache próprio. Em prod com múltiplos
workers, mesma org pode bater cache em uma, miss em outra. Acceptable: cache miss é
1 query barata.

## Voyage RAG

`apps/crm/src/lib/ai-agent/rag/voyage-client.ts`.

```ts
const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_TIMEOUT_MS = 60_000;
const VOYAGE_MAX_RETRIES = 2;
const VOYAGE_MODEL = "voyage-3";  // dim 1024
```

### Fluxo de indexação (background)

1. Admin upload doc via UI `/agents/<id>/documents`.
2. `agent_knowledge_sources` row criado com `indexing_status='pending'`.
3. Worker (`apps/crm/src/app/api/agent-knowledge/index/route.ts` ou cron) chama
   `chunker.ts` pra dividir o doc em chunks (~500-800 chars cada).
4. Pra cada batch (max 128 chunks por call), chama `embedTexts(chunks, "document")`.
5. INSERT em `agent_knowledge_chunks` com embedding (vector(1024)).
6. UPDATE `agent_knowledge_sources.indexing_status='indexed'`.

Erros: status='failed' + `error_message`. Admin vê na UI e tenta reindexar.

### Fluxo de retrieval (runtime)

1. `runner.ts` chama `buildKnowledgeBlock(..., queryText)` com a msg do lead.
2. Se modo='rag', chama `retrieveWithAttempt`.
3. Voyage embed da query (`input_type='query'`).
4. RPC pgvector `match_agent_knowledge_chunks(orgId, configId, embedding, top_k)`.
5. Filtra distâncias > `RAG_DISTANCE_CEILING`.
6. Retorna `hits[]` com content + source_title + distance.

### Custo

| Operação | Modelo | Custo aprox |
| --- | --- | --- |
| Indexação 100KB doc | voyage-3 | $0.0002 |
| Retrieval por query | voyage-3 | $0.000002 |
| Top-k 3 chunks no prompt | gpt-5-mini | ~$0.0001 extra por turno |

`MODEL_PRICING` em `packages/shared/src/ai-agent/cost.ts`.

## Limites e degradação

### `null` returns (não bloqueia AI)

- Org sem nenhuma source `indexed` → `null`. IA roda sem contexto.
- Modo `rag` + Voyage caiu → `retrieveWithAttempt` retorna `{ success: false }` →
  `null`. IA roda sem contexto.
- Schema mismatch (RLS, coluna ausente em ambiente desatualizado) → catch + log →
  `null`. IA roda sem contexto.

### Log codes

| Code | Quando | Severidade |
| --- | --- | --- |
| `ai_agent_knowledge_inject_failed` | Exception fora dos casos esperados | error |
| `ai_agent_knowledge_full_load_failed` | SELECT chunks falhou | error |
| `ai_agent_knowledge_measure_failed` | SELECT total tokens falhou | error |
| `ai_agent_knowledge_full_exceeded_cap` | Forçou fallback pra rag por hard-cap | warn |

Dashboards: ver [09-observability.md](./09-observability.md).

## Pontos de extensão

### Trocar heurística de tokens

Hoje `estimateTokens(text) = Math.ceil(text.length / 3)` em
`packages/shared/src/ai-agent/token-estimate.ts`. Pra cliente em inglês majoritário,
chars/4 é mais preciso. Pra trocar:

1. Sub-package config (não global) — adicionar `CHARS_PER_TOKEN_<lang>`.
2. Detectar idioma do doc no chunker (mantém em `chunks.language`).
3. `measureKnowledgeTokens` agrupa por language e soma com divisor diferente.

Hoje: PT-BR hardcoded. Aceitável pra base de clientes atual.

### Trocar pra tiktoken real

```bash
pnpm add @dqbd/tiktoken
```

`estimateTokens(text)` vira `tiktoken.encoding_for_model("gpt-4o-mini").encode(text).length`.
Custo: WASM ~3MB bundle, cold-start +200ms serverless.

Quando vale: aparecer caso real onde a heurística decide errado (full block estourou janela
ou rag block teve doc pequeno). Hoje não há sinal.

### Trocar pra outro embedding model

`VOYAGE_MODEL = "voyage-3"` (dim 1024). Trocar pra `voyage-3-large` (dim 1024 também, mais
caro mas melhor):

1. Atualizar `VOYAGE_MODEL` em voyage-client.
2. Indexar tudo de novo (queue background job).
3. Não atualizar `embedding_dim` em DB porque é o mesmo.

Outros providers (OpenAI ada-002, Cohere) exigiriam mudança no vector dim → migration nova
+ reindexação completa.

### Add `tokens` count em chunks

Migration nova adicionando `agent_knowledge_chunks.tokens int`. Indexer popula com
`estimateTokens(content)`. `measureKnowledgeTokens` muda pra `SUM(tokens)` em vez de
calcular em runtime — economia de CPU em orgs grandes.

Não implementado por preguiça válida (hoje runtime é OK).

## Cross-refs

- Threshold em tokens decisão: [INVARIANTS § 5.2](./INVARIANTS.md)
- Tabelas RAG: [02-data-model.md § agent_knowledge_*](./02-data-model.md)
- AI loop consumer: [03-flow-runtime.md § Knowledge inject](./03-flow-runtime.md)
- Troubleshoot "IA não viu o doc": [10-runbooks.md](./10-runbooks.md)
