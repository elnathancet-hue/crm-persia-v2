# 11 — Migração OpenAI Responses API

> Auditoria segura para migrar o AI Agent de `chat.completions.create()` para
> `responses.create()` sem trocar o runtime em um big bang.
>
> **Status em 2026-05-28:** análise concluída, nenhuma mudança de runtime aplicada.

## Conclusão executiva

O produto já usa OpenAI, mas o runtime principal ainda usa Chat Completions:

```ts
client.chat.completions.create(...)
```

A documentação atual da OpenAI recomenda a Responses API para novos projetos e
workflows agentic. A migração faz sentido para o AI Agent, mas **não é uma troca
simples de método**. O contrato de tools, retorno, usage e controle de tokens muda.

Decisão segura: migrar por fases, com adaptador e feature flag.

```txt
AI_AGENT_OPENAI_API=chat      # default inicial
AI_AGENT_OPENAI_API=responses # opt-in controlado
```

## Correção de escopo: não usamos Assistants API

Esta auditoria é especificamente sobre **Chat Completions → Responses API**.

O produto **não usa Assistants API** no runtime do AI Agent. Qualquer orientação da
OpenAI sobre "transição leve" a partir de Assistants API não se aplica diretamente ao
nosso caso.

Estado atual real:

```txt
AI Agent runtime:      chat.completions.create()
Legacy helpers:        chat.completions.create()
Assistants API:        não usada no runtime
Responses API:         ainda não usada
```

Consequência: a migração não deve ser tratada como compatibilidade automática nem como
troca superficial. Para nós, é uma migração de contrato do loop LLM:

- `messages` → `input`;
- `choices[0].message.tool_calls` → itens `function_call` em `response.output`;
- tool result como `role: "tool"` → item `function_call_output`;
- `prompt_tokens/completion_tokens` → `input_tokens/output_tokens`;
- `max_tokens/max_completion_tokens` → `max_output_tokens`.

## Escopo recomendado

Migrar primeiro apenas o AI Agent flow runner:

- `apps/crm/src/lib/ai-agent/flow/runner.ts`

Não migrar na primeira fase:

- `apps/crm/src/lib/ai/openai.ts` — legacy helper usado fora do flow.
- `apps/admin/src/lib/ai/openai.ts` — admin simples, sem loop agentic.
- `apps/crm/src/lib/ai-agent/summarization.ts` — resumo linear, baixo risco/benefício.
- `apps/crm/src/lib/ai-agent/handoff-notification.ts` — fail-soft, baixo benefício.
- fallback legacy em `incoming-pipeline.ts`.

Motivo: o runner é o ponto agentic real, com tools, eventos, RAG, histórico, auditoria
e custos. É onde a Responses API traz maior ganho e maior risco.

## Diferenças de contrato

### 1. Endpoint e SDK

Hoje:

```ts
const completion = await client.chat.completions.create({
  model,
  messages,
  tools,
  tool_choice: "auto",
  max_completion_tokens: 4096,
});
```

Responses:

```ts
const response = await client.responses.create({
  model,
  input,
  tools,
  max_output_tokens: 4096,
});
```

O SDK instalado (`openai@6.34.0`) já expõe `client.responses.create`, `output_text`,
`ResponseUsage`, `function_call_output`, `previous_response_id` e `max_output_tokens`.

### 2. Mensagens vs itens

Chat Completions trabalha com `messages`.

Responses trabalha com `input` e retorna `output[]`, onde cada item pode ser mensagem,
reasoning, function call, tool output, etc.

O runner atual depende de:

- `completion.choices[0]`
- `choice.finish_reason`
- `choice.message.content`
- `choice.message.tool_calls`

Nada disso deve vazar para a camada nova. O adaptador precisa normalizar a saída para
um contrato interno estável.

### 3. Tool calling

Chat Completions:

```ts
{
  type: "function",
  function: {
    name,
    description,
    parameters
  }
}
```

Responses:

```ts
{
  type: "function",
  name,
  description,
  parameters
}
```

Riscos:

- Responses usa function calls como itens em `response.output`.
- A resposta da tool volta como item `function_call_output`.
- Functions em Responses são strict por padrão. Schemas permissivas ou incompletas
  podem falhar onde hoje passavam.

Antes de ligar em produção, validar todos os `agent_tools.input_schema` usados pelo
runner contra strict mode.

### 4. Usage e custos

Chat Completions:

```ts
usage.prompt_tokens
usage.completion_tokens
```

Responses:

```ts
usage.input_tokens
usage.output_tokens
```

O runner atual soma:

- `result.tokens_input`
- `result.tokens_output`

A migração deve preservar esses campos exatamente, só trocando a fonte dos valores.
Qualquer erro aqui quebra auditoria, custo e limites.

### 5. Controle de output

Hoje:

```ts
model.startsWith("gpt-5") ? "max_completion_tokens" : "max_tokens"
```

Responses:

```ts
max_output_tokens: 4096
```

Não manter a lógica antiga dentro do caminho Responses. O adaptador deve mapear o cap
para o parâmetro correto por API.

### 6. Estado de conversa

Responses suporta `previous_response_id` e Conversations API. Não usar isso na primeira
fase.

O estado canônico do produto hoje é:

- `agent_conversations`
- `history_summary`
- últimas N mensagens da tabela `messages`
- `current_node_id`

Primeira migração deve manter esse estado manual. Só depois avaliar `previous_response_id`,
porque ele muda rastreabilidade, replay e debugging.

## Contrato interno pro adaptador

Criar módulo novo:

```txt
apps/crm/src/lib/ai-agent/flow/openai-runtime.ts
```

Interface sugerida:

```ts
type AgentLlmInput = {
  model: string;
  system: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools: AgentLlmTool[];
  maxOutputTokens: number;
};

type AgentLlmOutput = {
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    argumentsJson: string;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishKind: "final" | "tool_calls" | "incomplete";
  rawProvider: "chat_completions" | "responses";
};
```

O runner deve consumir `AgentLlmOutput`, não diretamente `ChatCompletion` nem `Response`.

## Ordem segura de PRs

### PR 1 — Auditoria e contrato

Esta doc. Sem runtime.

Checklist:

- documentar diferenças;
- listar riscos;
- definir feature flag;
- definir contrato interno.

### PR 2 — Adaptador isolado

Status: implementado em `apps/crm/src/lib/ai-agent/flow/openai-runtime.ts`.

Adicionar `openai-runtime.ts` com duas implementações:

- `runChatCompletionTurn(...)`
- `runResponsesTurn(...)`

Default ainda não usado pelo runner.

Testes unitários do adaptador com mocks:

- resposta final sem tool;
- uma function call;
- múltiplas function calls;
- usage ausente;
- output incompleto;
- JSON inválido em arguments.

### PR 3 — Validador de schemas strict

Adicionar helper/test que varre tools fixtures e schemas nativas.

Objetivo: encontrar antes do runtime qualquer schema incompatível com Responses strict.

Não alterar schemas compartilhadas nesta PR, exceto se teste provar bug.

### PR 4 — Runner com feature flag

Alterar `executeAIAgentNode` para chamar o adaptador:

```ts
const apiMode = process.env.AI_AGENT_OPENAI_API === "responses"
  ? "responses"
  : "chat";
```

Default: `chat`.

Teste obrigatórios:

- todos testes atuais do runner continuam passando em `chat`;
- novos testes cobrem `responses`;
- `emit_event` continua escolhendo edge nomeada;
- tool nativa continua retornando tool output;
- custo/tokens continuam preenchidos;
- send-guard não muda.

### PR 5 — Opt-in em ambiente controlado

Ativar `AI_AGENT_OPENAI_API=responses` só em ambiente de teste/staging.

Validar manualmente:

- conversa simples;
- conversa com RAG;
- `emit_event`;
- `move_pipeline_stage`;
- `trigger_notification`;
- erro de tool;
- handoff humano mid-run;
- tester live.

### PR 6 — Default Responses

Só depois de comparar logs e runs reais.

Trocar default para `responses`, mantendo fallback `chat` por pelo menos um ciclo de
release.

## Critérios de bloqueio

Não avançar para PR 4 se qualquer item abaixo estiver pendente:

- Não há teste de function call Responses.
- Não há teste de `emit_event`.
- Não há mapeamento confiável de usage.
- Não há fallback por env.
- Schemas de tools nativas não foram revisadas contra strict mode.
- `agent_steps` não registra provider/mode suficiente para debug.

## Observabilidade exigida

Ao ligar Responses, registrar nos eventos/auditoria:

- provider mode: `chat_completions` ou `responses`;
- model;
- input/output tokens;
- quantidade de tool calls;
- resposta incompleta por `max_output_tokens`;
- erro bruto sanitizado.

Não gravar prompts completos em logs de produção.

## O que não fazer

- Não trocar todos os helpers OpenAI do repo de uma vez.
- Não usar `previous_response_id` na primeira fase.
- Não remover Chat Completions antes de um ciclo real em produção.
- Não mudar preços/cost model junto da migração.
- Não alterar `packages/shared/src/ai-agent/*` sem PR de contract change.

## Resultado esperado

Depois da migração completa:

- AI Agent flow runner alinhado com a API recomendada pela OpenAI.
- Chat Completions ainda disponível como fallback operacional.
- Tool loop preservado.
- Custos e auditoria continuam comparáveis antes/depois.
- Próximas melhorias ficam desbloqueadas: built-in file search, melhor reasoning,
  stateful context e streaming mais limpo.
