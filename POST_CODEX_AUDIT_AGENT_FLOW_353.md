# Post-Codex Audit - AI Agent Flow apos PR #353

**Data:** 26/mai/2026
**Escopo:** auditoria estrutural do fluxo do AI Agent apos merges #345-#353.
**Objetivo:** verificar se criacao, configuracao, canvas, persistencia e runtime
do flow estao coerentes end-to-end.

---

## Caminho auditado

1. Criacao de agente e materializacao de `agent_flows`.
2. Configuracao geral do agente e prompt global.
3. Canvas visual em `@persia/ai-agent-ui`.
4. `saveFlow`/`getFlow` e normalizacao de `FlowConfig`.
5. Executor realtime, tester e triggers CRM (`stage_entered`/`segment_entered`).
6. Validacao local com typecheck e testes focados.

---

## Veredito

A estrutura base funciona no caminho feliz:

- `createAgent` materializa `agent_flows`.
- A UI edita nodes/edges e salva via `saveFlow`.
- O loader normaliza JSONB defensivamente.
- O runner executa `entry`, `ai_agent`, `action` e `condition`.
- Triggers de etapa e segmentacao existem.
- Prompt global do agente entra no AI node.

Mas a auditoria encontrou tres riscos estruturais antes de considerar o fluxo
confiavel em producao.

---

## Achados

### Alta - Actions terminais podem ser reexecutadas

O executor persiste sempre:

- `agent_conversations.current_node_id = result.ending_node_id`
- Referencia: `apps/crm/src/lib/ai-agent/executor.ts`

Isso e correto quando o flow termina em um `ai_agent` que precisa continuar a
conversa. Mas e perigoso quando termina em `action` ou `condition`.

Exemplo:

1. Flow termina em `send_whatsapp_message`.
2. Executor salva `current_node_id = "msg-1"`.
3. Lead manda nova mensagem.
4. Runner inicia diretamente em `msg-1`.
5. A mensagem/action pode ser reexecutada sem passar por entry/IA.

Impacto: mensagens repetidas, tags reaplicadas, transferencia repetida ou flow
preso em acao terminal.

### Alta - UI permite salvar flow invalido

`FlowCanvas` calcula `validationIssues` e mostra painel visual, mas `handleSave`
nao bloqueia erros.

Consequencia: flow sem entry, entry sem proximo passo, handles invalidos ou
multiplas entradas podem ser persistidos. Como publicar o agente virou ativar
status, um agente ativo pode rodar com flow estruturalmente quebrado.

### Media - `remove_tag` aparece na UI, mas runtime nao executa

O action type existe no contrato e aparece no catalogo do canvas. A validacao
aceita a acao. Porem o runner declara que `remove_tag` nao tem handler nativo e
emite apenas guardrail, seguindo default.

Impacto: cliente acredita que a tag foi removida, mas nada acontece.

---

## Pontos saudaveis

- Loader normaliza flow defensivamente.
- `saveFlow` valida org/config antes de persistir.
- Runtime de conditions segue `yes`/`no`.
- Triggers CRM de etapa e segmentacao estao conectados.
- Prompt global em Configuracao entra no prompt final do AI node.

---

## Validacao rodada

```text
pnpm.cmd --filter @persia/crm exec vitest run \
  src/__tests__/flow-runner.test.ts \
  src/__tests__/ai-agent-routing-stickiness.test.ts \
  src/__tests__/ai-agent-configs.test.ts

pnpm.cmd --filter @persia/ai-agent-ui typecheck
```

Resultado: 20 testes passaram; typecheck passou. Ambiente local em Node
v24.11.0 mostra warning porque o CRM declara Node 20.x.

---

## Proxima recomendacao

Atacar primeiro a persistencia de `current_node_id` terminal. Esse e o risco
mais provavel de gerar comportamento errado em producao mesmo quando o flow
parece correto no canvas.

---

# Segunda auditoria - partes nao cobertas na primeira rodada

**Escopo adicional:** paridade Admin/CRM, contratos compartilhados, catalogos
de flow e consistencia do editor compartilhado.

## Veredito da segunda rodada

O CRM esta mais avancado que o Admin. Como ambos renderizam os mesmos
componentes de UI (`AgentsList` e `AgentEditor`), essa diferenca vira bug de
produto: a tela sugere que os mesmos recursos existem nos dois contextos, mas
as server actions do Admin ainda salvam/seedam menos coisa.

Tambem existe uma deriva de contrato: o runtime ja entende ferramentas MCP,
mas o pacote compartilhado ainda nao modela esse modo de execucao.

## Achados adicionais

### Alta - Criacao de agente pelo Admin nao materializa o flow

O CRM cria agente com:

- `new_lead_stage_id` resolvido/validado.
- `is_primary` automatico para o primeiro agente.
- `behavior_mode = "flow"`.
- template aplicado quando `template_slug` existe.
- seed de `agent_flows` com entry + AI node.
- seed de `emit_event` quando o template precisa navegar handles nomeados.

Referencias:

- `apps/crm/src/actions/ai-agent/configs.ts:72`
- `apps/crm/src/actions/ai-agent/configs.ts:96`
- `apps/crm/src/actions/ai-agent/configs.ts:97`
- `apps/crm/src/actions/ai-agent/configs.ts:101`
- `apps/crm/src/actions/ai-agent/configs.ts:120`
- `apps/crm/src/actions/ai-agent/configs.ts:538`

O Admin, no mesmo fluxo visual, cria apenas `agent_configs` + `stop_agent`.
Nao ha `template_slug`, `agent_flows`, `new_lead_stage_id`, `behavior_mode` ou
primeiro agente principal na criacao.

Referencias:

- `apps/admin/src/actions/ai-agent/configs.ts:47`
- `apps/admin/src/actions/ai-agent/configs.ts:112`

Impacto: agente criado pelo Admin pode aparecer como configuravel na UI, mas
abrir sem flow materializado. Se ativado, o executor encontra `no_flow` e pula
a execucao.

### Alta - Update do Admin ignora campos que a UI compartilhada pode editar

O CRM persiste `new_lead_stage_id` e faz merge seguro de `humanization_config`.
O Admin nao possui esses branches no `updateAgent`.

Referencias CRM:

- `apps/crm/src/actions/ai-agent/configs.ts:175`
- `apps/crm/src/actions/ai-agent/configs.ts:182`

Referencias Admin:

- `apps/admin/src/actions/ai-agent/configs.ts:112`

Impacto: no Admin, a UI pode parecer salvar partes da configuracao, mas a
server action descarta campos novos. Isso gera falsa confianca e diferenca de
comportamento entre Admin e CRM.

### Media - Catalogo de etapas no Admin nao resolve nome do funil

O CRM carrega pipelines e preenche `pipeline_name`. O Admin retorna
`pipeline_name: ""`.

Referencias:

- `apps/crm/src/actions/ai-agent/flow-catalogs.ts:16`
- `apps/crm/src/actions/ai-agent/flow-catalogs.ts:56`
- `apps/crm/src/actions/ai-agent/flow-catalogs.ts:114`
- `apps/admin/src/actions/ai-agent/flow-catalogs.ts:87`
- `packages/ai-agent-ui/src/components/RulesTab.tsx:314`

Impacto: depois da mudanca para selecionar primeiro o funil e depois a etapa,
o Admin pode mostrar fallback tecnico (`Funil <id>`) em vez do nome real,
reintroduzindo a confusao visual que foi corrigida no CRM.

### Media - Contrato compartilhado nao conhece `execution_mode = "mcp"`

O runner do CRM carrega e executa ferramentas com `execution_mode: "mcp"`.
Mas o contrato compartilhado ainda define:

```ts
export type ToolExecutionMode = "native" | "n8n_webhook";
```

Referencias:

- `apps/crm/src/lib/ai-agent/flow/runner.ts:174`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:626`
- `packages/shared/src/ai-agent/types.ts:72`
- `packages/shared/src/ai-agent/types.ts:174`

Impacto: DB/runtime e tipos de UI/actions estao fora de sincronia. Isso tende
a forcar casts locais, impedir forms genericos de MCP ou esconder estados
validos do produto.

## Recomendacao apos segunda rodada

Atacar em duas PRs separadas:

1. Corrigir a paridade Admin/CRM de `configs.ts` e `flow-catalogs.ts`.
2. Atualizar o contrato compartilhado de ferramentas para incluir MCP de forma
   tipada, cobrindo UI/actions e testes.

---

# Terceira auditoria - riscos funcionais que ainda podiam passar

**Escopo refinado:** procurar pontos em que o canvas fica visualmente coerente,
mas o runtime nao consegue executar o fluxo como o usuario espera.

## Veredito da terceira rodada

Foram encontrados tres riscos mais proximos de producao do que os achados de
layout/paridade. Eles afetam diretamente a capacidade do fluxo de iniciar,
ramificar ou mover o lead.

## Achados refinados

### Alta - Agente "Em branco" pode nascer sem `agent_flows`

O wizard oferece o template `blank` como opcao de comecar do zero. O texto do
template diz que o flow vem com uma entrada + um node IA, mas a action do CRM
so chama `applyTemplate` quando `template_slug` existe e passa em
`isAgentTemplateSlug`.

Referencias:

- `packages/shared/src/ai-agent/agent-templates.ts:91`
- `packages/shared/src/ai-agent/agent-templates.ts:95`
- `apps/crm/src/actions/ai-agent/configs.ts:120`
- `apps/crm/src/actions/ai-agent/configs.ts:538`
- `apps/crm/src/lib/ai-agent/executor.ts:959`

Impacto: se o agente em branco for criado e ativado antes de salvar o canvas,
o executor carrega sem flow e pula com `flow_executor_no_flow`. A UI ate permite
criar o flow depois via `saveFlow`, mas a criacao inicial nao garante a
estrutura minima prometida pelo template.

Recomendacao: seedar um flow minimo para todo agente criado, inclusive
`blank`, ou remover a promessa do template e impedir ativacao enquanto
`agent_flows` nao existir.

### Alta - Template com eventos de IA pode nao conseguir ramificar

O runner so segue saidas nomeadas do node IA quando a IA chama a tool
`emit_event`. Essa tool precisa estar em `agent_flows.enabled_tools`, pois
`loadEnabledTools` so expoe ao modelo IDs dessa allowlist.

O `applyTemplate` cria a tool `emit_event`, mas quando o template ja possui
`flow_config` proprio, salva `flowConfig.enabled_tools` diretamente. No template
Humana Saude, o node IA tem quatro `instructions`/handles, mas
`enabled_tools` esta vazio.

Referencias:

- `apps/crm/src/actions/ai-agent/configs.ts:479`
- `apps/crm/src/actions/ai-agent/configs.ts:504`
- `apps/crm/src/actions/ai-agent/configs.ts:535`
- `apps/crm/src/actions/ai-agent/configs.ts:544`
- `packages/shared/src/ai-agent/agent-templates.ts:369`
- `packages/shared/src/ai-agent/agent-templates.ts:530`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:184`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:276`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:519`

Impacto: o canvas mostra quatro saidas conectadas, o prompt manda chamar
`emit_event`, mas o modelo nao recebe a tool. Resultado provavel: a IA conversa
normalmente e o fluxo nunca atravessa as edges `coletou_idade`,
`dados_completos`, `documentos_enviados` ou `ia_encerrou`.

Recomendacao: ao aplicar template com `flow_config`, mesclar o ID recem-criado
de `emit_event` em `enabled_tools` quando houver AI node com `instructions`.
Tambem vale validar/sinalizar no canvas: "eventos de saida exigem emit_event
habilitado".

### Alta - Eventos de saida adicionados manualmente nao garantem `emit_event`

O editor do AI node permite adicionar "Eventos de saida". Cada evento cria um
handle visual e o prompt instrui a IA a chamar `emit_event`. Mas o `FlowCanvas`
apenas carrega/preserva `enabled_tools`; nao ha UI visivel para adicionar a
tool `emit_event` ao allowlist do flow.

Referencias:

- `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:517`
- `packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx:175`
- `packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx:232`
- `packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx:844`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:184`

Impacto: em agentes criados em branco ou flows criados manualmente, o usuario
pode desenhar branches de IA perfeitamente, mas eles nao disparam porque a
tool de evento nao esta exposta ao modelo.

Recomendacao: tornar `emit_event` uma tool interna obrigatoria quando qualquer
AI node tiver `instructions.length > 0`, sem depender de UI de ferramentas.

### Media - "Mover etapa do funil" permite escolher etapa que o runtime rejeita

A action `move_pipeline_stage` mostra todas as etapas no select e salva apenas
`stage_name`. O handler, por seguranca, resolve `stage_name` dentro do funil
atual do lead. Se o usuario selecionar uma etapa de outro funil com o mesmo
nome ou uma etapa que nao existe no funil atual do lead, a action falha em
runtime.

Referencias:

- `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:621`
- `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:627`
- `apps/crm/src/lib/ai-agent/tools/move-pipeline-stage.ts:93`
- `apps/crm/src/lib/ai-agent/tools/move-pipeline-stage.ts:108`
- `apps/crm/src/lib/ai-agent/tools/move-pipeline-stage.ts:118`

Impacto: depois da correcao de pipeline primeiro/etapa depois na configuracao
inicial, o action node ainda ficou com UX antiga. O cliente pode selecionar
uma etapa visualmente valida, mas o lead nao move.

Recomendacao: o action node deve salvar `stage_id` e exibir primeiro o funil,
depois a etapa, ou restringir a lista ao funil de entrada quando o flow for
stage-driven.

### Media - CRM event entry conectado direto em IA salva, mas nao conversa

A validacao atual marca `crm_event_to_ai` apenas como warning. No runtime, se o
flow e disparado por `pipeline_stage_entered` ou `segment_entered`, o inbound
text e vazio; quando o proximo node e IA, o runner pula a chamada ao modelo e
segue apenas a edge default.

Referencias:

- `packages/shared/src/ai-agent/flow-validation.ts:140`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:233`

Impacto: o usuario pode criar "Entrou na etapa -> IA", salvar e ativar. Na
execucao real, a IA nao envia mensagem porque nao ha inbound para responder.
Se nao houver edge default saindo da IA, o flow termina silenciosamente.

Recomendacao: transformar esse warning em erro quando o entry e de evento CRM
e o alvo imediato e `ai_agent`, ou auto-inserir/sugerir um action node
`send_whatsapp_message`.

## Ordem de ataque recomendada

1. Garantir seed minimo de `agent_flows` e `emit_event` para blank/manual.
2. Corrigir `applyTemplate` para mesclar `emit_event` em templates com
   `instructions`.
3. Ajustar `move_pipeline_stage` para salvar `stage_id` com selecao por funil.
4. Endurecer validacao de CRM event -> AI para evitar flow que termina sem
   falar com o lead.

---

# Quarta auditoria - navegacao por cada acao do canvas

**Escopo refinado:** auditar cada card de acao em `FlowCanvas`, comparando:

1. payload inicial do catalogo;
2. formulario de configuracao;
3. validacao de `FlowConfig`;
4. execucao no `runner.ts`;
5. handler nativo real.

## Veredito da auditoria por acao

O problema central nao esta em uma acao isolada: o `runner.ts` chama handlers
nativos sem injetar o contexto enriquecido que eles esperam (`db`, `provider`,
`config`, `agentConversation`, etc.).

Referencias:

- `apps/crm/src/lib/ai-agent/flow/runner.ts:603`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:793`
- `apps/crm/src/lib/ai-agent/tools/shared.ts:11`
- `apps/crm/src/lib/ai-agent/tools/shared.ts:20`
- `apps/crm/src/lib/ai-agent/tools/shared.ts:26`
- `apps/crm/src/lib/ai-agent/tools/shared.ts:30`

Impacto: a maioria das actions que parecem configuradas no canvas falha em
runtime com `database context missing`, `provider context missing` ou `agent
config missing`. O unico card deterministico claramente funcional hoje e
`send_whatsapp_message`, porque ele nao usa handler nativo: o proprio runner
emite `send_text` para o provider do flow.

## Matriz por acao

| Acao no canvas | Status funcional | Motivo |
| --- | --- | --- |
| `send_whatsapp_message` | OK com ressalva | Special-case no runner; emite `send_text` e o realtime-provider envia/persiste. Ressalva: o runner marca sucesso antes de saber se o provider realmente entregou, porque o envio e fire-and-forget. |
| `add_tag` | Quebrada no flow runner | Handler exige `db` via `getHandlerDb`; runner nao injeta. Mesmo corrigindo isso, o handler cria tag se nao existir, enquanto a UI sugere selecionar tag existente. |
| `remove_tag` | Nao implementada | UI/catalogo/validacao aceitam, mas `directHandlers` nao mapeia. O runner emite guardrail e segue a edge default sem remover nada. |
| `move_pipeline_stage` | Quebrada + UX divergente | Falha sem `db`. Alem disso, UI salva `stage_name` de uma lista global; handler resolve dentro do funil atual do lead. Pode selecionar uma etapa visualmente valida que o runtime rejeita. |
| `create_appointment` | Inviavel como action deterministica atual | Handler exige `start_at` e `type_slug` ou `title`/`duration_minutes`. O formulario da action so permite `type_slug` opcional; nao ha campo para data/hora. Como tool da IA faz sentido; como card deterministico com `config: {}` tende a falhar por input invalido. |
| `trigger_notification` | Quebrada no flow runner | Handler exige `db`, `config` e provider para dispatch. Runner nao injeta nenhum deles. |
| `send_media` | Quebrada no flow runner | Handler exige `db` e `provider` real. Runner nao injeta; alem disso o formulario pede slug manual em vez de picker de midia. |
| `transfer_to_user` | Quebrada no flow runner | Handler exige `db`; runner nao injeta. Depois de corrigido, a UI esta alinhada porque salva email/user id e o handler aceita `user`. |
| `round_robin_user` | Quebrada no flow runner | Handler exige `db`; runner nao injeta. Depois de corrigido, tende a funcionar, mas nao tem filtros de departamento/fila. |
| `transfer_to_agent` | Quebrada e possivelmente legado | Alem de faltar `db`, o handler usa `agent_stages` e `current_stage_id`, conceitos do modelo anterior. No flow pivot, a transferencia deveria provavelmente trocar `config_id` e reiniciar no entry/current_node_id do agente alvo. |
| `stop_agent` | Quebrada no flow runner | Handler exige `db` para pausar. Para notificacao de handoff, tambem precisa `config`, `agentConversation`, provider e OpenAI client. Runner nao injeta. |
| `set_lead_custom_field` | Quebrada no flow runner | Handler exige `db`; runner nao injeta. Alem disso, a UI promete variaveis tipo `{{lead.name}}`, mas o handler grava o valor literal sem interpolacao. |

## Achados criticos por acao

### Critica - Handlers nativos nao recebem `db` no flow runner

Todos estes handlers chamam `getHandlerDb(context)` e falham sem `db`:

- `add_tag`
- `move_pipeline_stage`
- `create_appointment`
- `send_media`
- `transfer_to_user`
- `round_robin_user`
- `transfer_to_agent`
- `trigger_notification`
- `stop_agent`
- `set_lead_custom_field`

No runner, tanto tool calls da IA quanto action nodes montam contexto apenas
com IDs basicos (`organization_id`, `lead_id`, `crm_conversation_id`,
`agent_conversation_id`, `run_id`, `dry_run`). O campo `db` nunca e passado.

Impacto: o flow pode conversar, mas qualquer acao real do CRM tende a falhar.
Isso compromete o objetivo principal do canvas: transformar garantias
operacionais em nodes deterministas.

Recomendacao: criar um helper unico de contexto nativo para o flow runner,
exemplo `buildNativeHandlerContext(db, ctx, extras)`, usado por
`dispatchToolCall` e `executeActionNode`.

### Critica - `transfer_to_agent` ainda aponta para o modelo antigo de stages

O handler de transferencia para outro agente busca `agent_stages` e grava
`current_stage_id`. Esse modelo foi substituido pelo flow pivot, que persiste
`current_node_id`.

Impacto: mesmo depois de passar `db`, essa action pode falhar com "target agent
config has no stages" ou transferir para um estado que o runner novo nao usa.

Recomendacao: reescrever `transfer_to_agent` para o modelo flow:

- resolver agente alvo ativo;
- trocar `agent_conversations.config_id`;
- limpar `current_node_id`;
- deixar o proximo turno iniciar pelo entry do flow alvo;
- preservar `history_summary` e `variables`.

### Alta - `create_appointment` nao tem formulario suficiente para action node

Como tool chamada pela IA, `create_appointment` faz sentido porque a IA coleta
data/hora e passa `start_at`. Como action deterministica do canvas, o formulario
nao coleta `start_at`, e o default do catalogo e `config: {}`.

Impacto: cliente arrasta "Criar agendamento", salva, e na execucao a action
falha por input invalido. O canvas da a entender que agendamento e uma acao
configuravel, mas falta a origem dos dados.

Recomendacao: uma destas opcoes:

1. remover `create_appointment` das action nodes deterministicas e manter
   apenas como tool da IA;
2. transformar o card em "Criar agendamento a partir dos dados coletados",
   com mapeamento explicito de variaveis (`start_at`, `type_slug`, email);
3. exigir que ele venha depois de um AI node que emite payload estruturado.

### Alta - `stop_agent`, `trigger_notification` e `send_media` precisam de provider/config

Mesmo se o `db` for injetado, essas actions precisam de mais contexto:

- `stop_agent`: `config`, `agentConversation`, provider e OpenAI client para
  handoff notification com resumo.
- `trigger_notification`: `config` e provider para carregar template do agente
  e enviar WhatsApp.
- `send_media`: provider real para enviar arquivo pelo WhatsApp.

Impacto: corrigir apenas `db` resolve parte das actions, mas essas continuam
parciais ou sem efeitos externos.

Recomendacao: enriquecer `FlowRunContext` ou criar um `NativeRuntimeContext`
com os recursos ja existentes no executor/realtime provider.

### Media - UI promete interpolacao em `set_lead_custom_field`, mas handler grava literal

O formulario diz que pode usar `{{lead.name}}`, mas o handler apenas grava a
string recebida em `lead_custom_field_values`.

Referencias:

- `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:720`
- `apps/crm/src/lib/ai-agent/tools/set-lead-custom-field.ts:22`

Impacto: se o cliente configurar `{{lead.name}}`, o campo pode receber o texto
literal `{{lead.name}}`, nao o nome do lead.

Recomendacao: implementar interpolacao compartilhada para action nodes ou
remover a promessa da UI ate existir.

## Ordem de ataque recomendada por acao

1. Corrigir o contexto dos handlers no flow runner (`db` primeiro).
2. Revalidar `add_tag`, `move_pipeline_stage`, `transfer_to_user`,
   `round_robin_user` e `set_lead_custom_field` com testes de runner.
3. Reescrever `transfer_to_agent` para `current_node_id`.
4. Decidir o produto de `create_appointment` como action deterministica.
5. Injetar provider/config para `stop_agent`, `trigger_notification` e
   `send_media`.
6. Remover ou implementar `remove_tag`.

---

# Quinta auditoria - entrada do webhook, idempotencia e concorrencia

**Data:** 26/mai/2026
**Escopo refinado:** superficie de entrada antes do flow runner — webhook
UAZAPI/Meta → `tryEnqueueForNativeAgent` → debounce/flush. Auditoria nasceu
do gap entre as 4 rodadas anteriores (todas dentro do runner) e o caminho
real de producao, onde mensagens chegam por retries de provider e em paralelo.

## Caminho auditado

1. `apps/crm/src/app/api/whatsapp/webhook/route.ts` (UAZAPI).
2. `apps/crm/src/app/api/whatsapp/webhook/meta/[phone_number_id]/route.ts` (Meta).
3. `apps/crm/src/lib/ai-agent/executor.ts::tryEnqueueForNativeAgent`.
4. `apps/crm/src/lib/whatsapp/incoming-pipeline.ts::processIncomingMessage`.
5. `apps/crm/src/lib/ai-agent/debounce.ts` + RPC SQL em `019_ai_agent_debounce.sql`.
6. Indices/constraints de `agent_conversations` (migrations 017, 063, 067).

## Veredito da quinta rodada

A camada de mensagens esta protegida — dedup por `whatsapp_msg_id` esta em
3 locais (SELECT + UNIQUE em `messages` + ON CONFLICT em `pending_messages`).
HMAC e raw body estao intactos nos dois webhooks. O bug grave esta uma
camada acima: `agent_conversations` nao tem UNIQUE em
`(organization_id, lead_id, crm_conversation_id)`, e o caminho do AI Agent
nativo faz find-or-create sem fallback de race. Sob retry/concorrencia,
um mesmo lead pode acabar com duas linhas em `agent_conversations`,
duas filas de debounce paralelas e dois flushes simultaneos enviando
respostas duplicadas.

## Achados

### Critica - `agent_conversations` sem UNIQUE permite duplicacao sob concorrencia

`agent_conversations` so tem dois indices nao-unicos:

- `idx_agent_conversations_org_crm (organization_id, crm_conversation_id)`
- `idx_agent_conversations_org_lead (organization_id, lead_id)`

Nenhuma constraint UNIQUE em `(org, lead, crm_conversation_id)`. O caminho
de criacao no executor faz SELECT-then-INSERT sem captura de 23505:

Referencias:

- `apps/crm/supabase/migrations/017_ai_agent_core.sql:172`
- `apps/crm/supabase/migrations/017_ai_agent_core.sql:174`
- `apps/crm/src/lib/ai-agent/executor.ts:534`
- `apps/crm/src/lib/ai-agent/executor.ts:583`
- `apps/crm/src/lib/ai-agent/executor.ts:598`

Cenario reproduzivel:

1. UAZAPI manda duas mensagens do mesmo lead em <100ms (ou Meta retransmite
   o mesmo envelope antes do primeiro request fechar).
2. Ambos os `tryEnqueueForNativeAgent` rodam em paralelo na mesma instancia
   Node.
3. Ambos passam dedup de mensagens (msgs diferentes, ou ambos resolvidos
   via 23505 da UNIQUE de `messages`).
4. Ambos fazem `SELECT ... FROM agent_conversations WHERE org=X AND
   lead=Y AND crm_conversation_id=Z` — ambos veem `null` (primeira conversa).
5. Ambos fazem `INSERT INTO agent_conversations`. Sem UNIQUE, ambos sucedem.
6. Cada webhook enfileira sua mensagem com `inbound_message_id` diferente
   em `pending_messages.agent_conversation_id` distinto.
7. Cron flush pega os dois agent_conversations em paralelo, claim-lease
   garante uma flush por linha, mas as duas linhas pertencem ao mesmo lead.
8. Dois `executeDebouncedBatch` rodam em paralelo, dois `agent_runs`,
   duas chamadas `send_text` ao provider. Lead recebe duas respostas
   inconsistentes.

PR #339 introduziu stickiness por `config_id` no `tryEnqueueForNativeAgent`,
mas a verificacao so opera quando o SELECT encontra uma linha existente.
Na primeira mensagem da conversa, ainda nao ha linha, e o guard nao impede
duplicacao.

Impacto: producao com UAZAPI fazendo retry agressivo (comum quando o
webhook retorna lento) gera respostas duplicadas para o lead, dois runs
contabilizados, dois consumos de token, e — em casos sequenciais — dois
`current_node_id` divergindo no mesmo lead.

Recomendacao:

1. `CREATE UNIQUE INDEX agent_conversations_org_lead_crm_uniq ON
   agent_conversations (organization_id, lead_id, crm_conversation_id)
   WHERE crm_conversation_id IS NOT NULL;` (partial pra preservar linhas
   legacy onde crm_conversation_id era nullable).
2. No `executor.ts:583`, adicionar branch `if (agentConvErr?.code ===
   "23505") { re-SELECT pelo (org, lead, crm_conversation_id) }`, igual ao
   padrao ja usado em `conversations` (linha 439-461) e `messages`
   (linha 504-516).
3. Backfill: rodar query de cleanup para mesclar duplicatas existentes
   antes de aplicar UNIQUE (manter `current_node_id` mais avancado e
   merge de `actions_executed_detail`).

### Alta - Falha pos-creacao da `agent_conversations` joga no pipeline legacy duplicado

O catch externo de `tryEnqueueForNativeAgent` (linha 857-871) retorna
`handled: false` em qualquer erro, fazendo o webhook cair em
`processIncomingMessage`. Mas a falha pode ter acontecido APOS a
linha 583 (insert de agent_conversations), o que deixa estado parcial:

Referencias:

- `apps/crm/src/lib/ai-agent/executor.ts:583`
- `apps/crm/src/lib/ai-agent/executor.ts:828`
- `apps/crm/src/lib/ai-agent/executor.ts:843`
- `apps/crm/src/lib/ai-agent/executor.ts:864`
- `apps/crm/src/app/api/whatsapp/webhook/route.ts:218`
- `apps/crm/src/app/api/whatsapp/webhook/route.ts:237`

Cenario:

1. `agent_conversations` foi criado.
2. RPC `enqueue_pending_message` falha (timeout DB, RLS edge, etc).
3. `handled = false` → webhook chama `processIncomingMessage`.
4. Legacy cria conversation + messages + dispara n8n/OpenAI.
5. Quando o RPC recupera ou cron flush futuro pega o agent_conversation
   orfao, IA nativa tambem responde.

Impacto: lead recebe resposta do legacy + da IA nativa. Tambem polui
metrica `handled_by` no log.

Recomendacao: dividir o catch em dois niveis. Pre-creacao da
`agent_conversations` → fallback ao legacy. Pos-creacao → retorna
`handled: true` com `status: "native_error"` e log estruturado; o cron
flush retenta com lease.

### Alta - Lead INSERT no caminho nativo nao captura 23505

A pipeline legacy capta 23505 ao criar `leads` e re-SELECT (incoming-pipeline.ts:118-126).
O caminho nativo nao faz. Sob race de duas mensagens de phone novo, uma
das chamadas levanta `lead_create_failed` e cai pro fallback do catch
(handled=false → legacy).

Referencias:

- `apps/crm/src/lib/whatsapp/incoming-pipeline.ts:106`
- `apps/crm/src/lib/whatsapp/incoming-pipeline.ts:118`
- `apps/crm/src/lib/ai-agent/executor.ts:360`
- `apps/crm/src/lib/ai-agent/executor.ts:373`

Impacto: primeira mensagem do lead, em race, vai pro legacy pipeline (n8n
ou OpenAI antigo) em vez do AI Agent nativo. Cliente nota IA "esquecendo"
de seguir o flow configurado na primeira interacao quando duas msgs
chegam coladas.

Recomendacao: copiar o padrao 23505 do legacy: se `leadErr.code ===
"23505"`, re-SELECT pelo (org, phone) e seguir com `createdLead = false`
(nao dispara `onNewLead` duplicado, nao tenta avatar duplicado).

### Media - Webhook Meta processa mensagens sequencialmente sob timeout de 10s

`route.ts` do Meta itera `entry[].changes[].value.messages[]` com `for-of`
e aguarda cada `tryEnqueueForNativeAgent` + `processIncomingMessage`. Meta
Cloud espera 200 em <10s, senao retransmite o envelope inteiro.

Referencias:

- `apps/crm/src/app/api/whatsapp/webhook/meta/[phone_number_id]/route.ts:131`
- `apps/crm/src/app/api/whatsapp/webhook/meta/[phone_number_id]/route.ts:171`
- `apps/crm/src/app/api/whatsapp/webhook/meta/[phone_number_id]/route.ts:197`
- `apps/crm/src/app/api/whatsapp/webhook/meta/[phone_number_id]/route.ts:219`

Caminho native e leve (so DB inserts + RPC) e raramente passa 10s. Mas o
fallback para `processIncomingMessage` chama n8n com timeout default do
fetch (sem AbortController), e n8n pode levar 30-60s. Quando isso
acontece, Meta retransmite. O envelope retransmitido cria o mesmo lead
(legacy ja tem 23505 catch) mas tambem dispara `tryEnqueueForNativeAgent`
novamente, agora com `agent_conversations` ja existente — gerando dois
inbound enqueueds para o mesmo flush. RPC `ON CONFLICT
(inbound_message_id)` salva nesse caso especifico, mas se as duas
chamadas inserem MENSAGENS distintas (porque um retry vem com um
batch maior), o dedup nao cobre.

Impacto: respostas duplicadas em orgs Meta + n8n lento. UAZAPI tambem
sofre, mas com timeout de retry maior (~30s).

Recomendacao: retornar 200 imediatamente apos validar HMAC e enfileirar
o envelope cru em uma fila (Postgres `incoming_webhook_events` ou
similar) processada por worker assincrono. Curto prazo, encurtar n8n com
AbortController de 8s e fallback registrado.

### Media - Dedup `messages` cobre webhook, mas pending_messages aceita re-enfileiramento entre webhook e cron

A RPC `enqueue_pending_message` faz `ON CONFLICT (inbound_message_id) DO
NOTHING`. O `inbound_message_id` aponta para `messages.id`. Sob race
entre dois webhooks para a mesma `whatsapp_msg_id`, o segundo webhook
recupera o `messages.id` do primeiro (via 23505 + re-SELECT) e enfileira
com o MESMO `inbound_message_id` — a RPC entao deduplica corretamente.

Referencias:

- `apps/crm/supabase/migrations/019_ai_agent_debounce.sql:121`
- `apps/crm/src/lib/ai-agent/executor.ts:504`

Mas: o webhook UAZAPI nao retransmite com exatamente o mesmo whatsapp_msg_id
quando o app cliente envia uma edicao da mensagem (UAZAPI v2 emite EventType
diferente, e o messageid difere). Nesse caso, sao mensagens REAIS distintas,
o dedup nao se aplica, e ambas entram no flush — comportamento correto.

Pontos saudaveis:

- HMAC UAZAPI e Meta ambos sobre raw body via `await req.text()` antes do
  `JSON.parse`.
- `messages` tem UNIQUE em (org, whatsapp_msg_id) na migration 064.
- `conversations` tem UNIQUE partial em (org, lead) onde status em
  (active, waiting_human) via migration 063.
- Claim-lease em flush usa atomic UPDATE com WHERE expirou-OR-null.
- Pipeline legacy tem 23505 catch em lead, conv e message.

## Validacao rodada

Auditoria estatica somente — nao reproduzimos race em ambiente real porque
exige carregar UAZAPI/Meta em paralelo contra Supabase. Caminhos foram
validados via leitura cruzada de:

- `tryEnqueueForNativeAgent` (executor.ts:273-871).
- `processIncomingMessage` (incoming-pipeline.ts:48-643).
- RPC `enqueue_pending_message` (019_ai_agent_debounce.sql:85-140).
- RPC `claim_agent_conversation_flush` (019_ai_agent_debounce.sql:142-173).
- Indices/constraints atuais de `agent_conversations` (migrations 017,
  063, 067).

Recomendacao: adicionar teste de carga em CI ou staging com 2-4 mensagens
em paralelo do mesmo phone, monitorando `count(*) FROM agent_conversations
GROUP BY (org, lead, crm_conversation_id) HAVING count(*) > 1`. Esse query
e a metrica direta do achado critico.

## Ordem de ataque recomendada

1. Aplicar UNIQUE partial em `agent_conversations(org, lead,
   crm_conversation_id)` com migration nova + cleanup de duplicatas
   existentes em staging primeiro.
2. Adicionar 23505 catch no insert de agent_conversations (executor.ts:583).
3. Adicionar 23505 catch no insert de leads no caminho nativo
   (executor.ts:360).
4. Separar fallback pre/pos `agent_conversations` no catch externo do
   `tryEnqueueForNativeAgent`.
5. Encurtar timeout n8n + AbortController; medio prazo, mover processamento
   do webhook Meta para fila assincrona.

## Como casa com auditorias 1-4

A rodada 1 cobriu o caso terminal de `current_node_id`, que so se manifesta
em conversa ja estabelecida. Essa quinta rodada cobre o oposto — o caso de
PRIMEIRA mensagem, onde o `agent_conversations` ainda nao existe. As duas
juntas fecham o ciclo: criacao racy + reentrada terminal.

A rodada 4 mostrou que o runner nao injeta `db` nos handlers. Esse achado
fica mais critico apos a rodada 5, porque qualquer corrupcao de estado
(2x agent_conversations) ainda passa pelo runner que ja nao sabe agir
deterministicamente.

Recomendacao consolidada: bloquear merge de #354+ que toque webhook ou
executor ate o achado critico desta rodada estar resolvido.

---

# Sexta auditoria - custo, token economy e contexto em modo flow

**Data:** 26/mai/2026
**Escopo refinado:** o que o flow runner faz com custo, ceiling, historico
de conversa e budget de reasoning models. Auditoria nasceu de uma duvida
direta: se o sistema clampa thresholds e tem `tokens_used_total` na tabela,
algum lugar enforce. Resultado encontrou o oposto.

## Caminho auditado

1. `apps/crm/src/lib/ai-agent/cost-limits.ts` e callers reais.
2. `apps/crm/src/lib/ai-agent/summarization.ts` e callers reais.
3. `apps/crm/src/lib/ai-agent/executor.ts::executeDebouncedBatch` (audit/persist).
4. `apps/crm/src/lib/ai-agent/flow/runner.ts::runFlow + executeAIAgentNode`.
5. `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts` (full/rag/auto).
6. `packages/shared/src/ai-agent/cost.ts::calculateCostUsdCents`.
7. Schema de `agent_conversations.tokens_used_total` + `agent_runs.tokens_*`.

## Veredito da sexta rodada

A camada de medicao existe e e bem feita — pricing por modelo, agregacao
por dia/mes, snapshots tipados. A camada de enforcement nao existe no
runtime. `assertWithinCostLimits` e `shouldTriggerConversationSummarization`
sao funcoes exportadas, testadas em `__tests__`, e **nunca chamadas em
producao**. O flow runner roda sem ceiling, sem `max_completion_tokens`,
sem history de turns anteriores. O autor do executor documentou
explicitamente nas linhas 24-27 que "history_summary, RAG, humanization
split" sao V1-limitations — mas a UI ja ofereceu esses controles ao cliente.

## Achados

### Critica - `assertWithinCostLimits` e dead code em runtime

A funcao implementa ceiling por 4 escopos (run, agent_daily, org_daily,
org_monthly) e lanca `GuardrailError` quando estoura. Ela e importada
APENAS em um teste e no README:

Referencias:

- `apps/crm/src/lib/ai-agent/cost-limits.ts:43`
- `apps/crm/src/__tests__/ai-agent-pr4-runtime.test.ts:16`
- `apps/crm/src/lib/ai-agent/README.md:108`

Nenhum import em `executor.ts`, `runner.ts`, `executeAIAgentNode`,
`executeDebouncedBatch` ou qualquer caller real do flow.

Impacto direto: cliente cadastra limite em `agent_cost_limits` (UI em
LimitsEditor.tsx existe), e o cliente vê o consumo subindo em
`ActiveLimitsProgress`, mas o runtime nunca bloqueia. Quando estoura, a
unica notificacao e visual no admin — a IA continua respondendo
indefinidamente. Risco financeiro real em orgs com gpt-5 sem cap.

Recomendacao: chamar `assertWithinCostLimits` em dois pontos do executor:

1. Antes do `runFlow` em `executeDebouncedBatch` (pre-run check com
   `tokensSoFarRun = 0`).
2. Dentro do loop do `executeAIAgentNode`, apos cada `chat.completions.create`,
   somando `tokensIn + tokensOut` acumulado do run.

Se lancar GuardrailError, ja existe handling no flow (`kind: "guardrail"`
event) — basta marcar `result.fatal_error = "cost_ceiling"` e retornar.

### Critica - Flow runner nao envia historico de conversa

Em `executeAIAgentNode`, o array de `messages` para OpenAI e construido
toda chamada como:

```ts
const messages = [
  { role: "system", content: systemParts.join("\n\n") },
  { role: "user", content: ctx.inboundMessage.text },
];
```

Referencias:

- `apps/crm/src/lib/ai-agent/flow/runner.ts:312`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:315`
- `apps/crm/src/lib/ai-agent/executor.ts:27`

Nenhum select em `messages` para carregar turns anteriores. Nenhum uso de
`agent_conversations.history_summary`. O proprio header do executor.ts
declara como limitacao V1 (linha 27): "Sem RAG injection, sem
history_summary, sem humanization split". RAG/humanization foram
implementados depois (PR #235-238, PR #351), mas o history NAO foi.

Impacto: IA nao lembra do que o lead disse 2 mensagens atras. Se na
mensagem 1 o lead diz "meu nome e Joao", na mensagem 2 a IA pergunta
"qual seu nome?". Multi-turn coerente nao existe em modo flow. Cliente
cai do precipicio quando migra de behavior_mode=actions (que tem
history) para flow.

Recomendacao: antes de montar `messages` em executeAIAgentNode, carregar
ultimas N mensagens da conversation por (org, crm_conversation_id),
ordenadas por created_at DESC, mapeadas para `role: lead=user, ai=assistant`.
N deve respeitar `clampRecentMessagesCount` e, quando estourar,
prepender o `agent_conversations.history_summary` como primeira system
message. Helpers ja existem em `summarization.ts` — falta apenas o
caller.

### Critica - Flow runner nao chama `summarization.ts`

`shouldTriggerConversationSummarization`, `getConversationSummaryCounters`
e `normalizeContextSummarizationConfig` existem em
`apps/crm/src/lib/ai-agent/summarization.ts`. UI configura
`context_summary_turn_threshold`, `context_summary_token_threshold`,
`context_summary_recent_messages` no agent_config.

Referencias:

- `apps/crm/src/lib/ai-agent/summarization.ts:60`
- `packages/shared/src/ai-agent/summarization.ts:53`
- Busca por `shouldTriggerConversationSummarization` retorna 1 arquivo
  (o proprio modulo). Zero callers.

Como o runner tambem nao envia history (achado anterior), o tema
compactacao parece desnecessario hoje. Mas as duas coisas estao
acopladas: assim que o runner comecar a enviar historico, vai precisar
acionar summarization para evitar context-window blowup. O modulo de
summarize esta pronto e isolado — precisa apenas ser invocado.

Impacto: nao tem efeito real enquanto history nao for enviado. Vira
critico no mesmo PR que resolver o achado #2.

Recomendacao: implementar history-loading e summarization no MESMO PR —
sao tao acoplados que separar gera estado intermediario quebrado
(historico crescendo sem limite ate o primeiro 8k context-window error).

### Alta - Flow runner nao passa `max_completion_tokens` para OpenAI

A chamada `client.chat.completions.create({ model, messages, ...tools })`
em runner.ts:344 nao inclui `max_tokens` nem `max_completion_tokens`.
Para modelos gpt-5* (reasoning), OpenAI usa default proprio do modelo
(que pode chegar a 100k+ tokens de output incluindo reasoning).

Referencias:

- `apps/crm/src/lib/ai-agent/flow/runner.ts:344`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:347`

Combinacoes amplificadoras:

- `MAX_LLM_TOOL_PINGPONG = 5` por AI node → ate 5 chamadas LLM por node.
- `DEFAULT_MAX_ITERATIONS = 20` por flow run → ate 20 nodes traversados.
- Teto teorico = 100 chamadas LLM por flush, sem cap por chamada.

Impacto: agente mal configurado em gpt-5 pode queimar 30k-50k tokens em
um unico flush, com reasoning silencioso (cliente ve mensagem curta na
chat). Cost calculation esta correto (line 363-364 usa
`completion.usage.completion_tokens` que ja inclui reasoning_tokens),
mas como o ceiling nao e enforced (achado #1), o cliente so descobre
quando recebe a fatura.

Recomendacao: adicionar `max_completion_tokens` (gpt-5*) ou `max_tokens`
(gpt-4o*) na chamada. Valor inicial conservador: 4096 (cobre reasoning +
output medio). Selecionar pela presenca do prefixo do modelo:

```ts
const maxTokensKey = model.startsWith("gpt-5") ? "max_completion_tokens" : "max_tokens";
completion = await client.chat.completions.create({
  model,
  messages,
  [maxTokensKey]: 4096,
  ...(openaiTools.length > 0 ? { tools: openaiTools, tool_choice: "auto" } : {}),
});
```

Memory referenciava `buildMaxTokensParam` em `executor.ts:1645` com fix
`* 4` pendente. Esse helper nao existe mais no codigo atual (executor.ts
tem 1123 linhas, nao 1645). O pivot pro flow runner eliminou o helper
mas tambem eliminou o cap — agora nao ha cap algum.

### Alta - Knowledge mode "full" re-injeta documentos inteiros a cada turn

`buildFullModeBlock` em knowledge-injector.ts:115 carrega TODOS chunks
`indexing_status='completed'` do agente e concatena no system prompt.
Threshold automatico (`AUTO_FULL_BYTES_THRESHOLD = 30 * 1024`) so se
aplica em modo `auto` — se cliente forcar `full` manualmente em UI, nao
ha cap.

Referencias:

- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:41`
- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:99`
- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:115`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:260`

Cenario: agente com proposta comercial de 80KB + FAQ de 40KB + scripts
de objecao de 30KB = 150KB de knowledge block re-enviado em CADA turn
de CADA conversa. A 1.25 USD/1M tokens input (gpt-5), 150KB ~= 40k
tokens, ~5 cents por turn de input apenas, antes de output.

Impacto: factura mensal escala com (numero_conversas * turns_por_conversa
* tamanho_doc). Cliente acha estranho receber bill alta apos uplodar
docs grandes — comportamento e correto, mas opacidade do custo viola a
regra do memory "AI Agent — token economy oculta da UI cliente".

Recomendacao:

1. Hard-cap em `full` mode independente de modo (ex: AUTO_FULL ja existe
   com 30KB — aplicar tambem quando user escolhe manual).
2. Cache do bloco gerado por `(agent_config_id, sources_updated_at)` em
   uma coluna materializada ou memo em memoria por process — invalida
   so quando indexing job termina nova source.
3. Em modo `rag`, ja faz top-3 por query. Talvez baixar para top-2 em
   gpt-5 com knowledge ativo (reasoning ja consome muito).

### Media - `agent_conversations.tokens_used_total` acumula sem enforcement

Schema declara `tokens_used_total` em `agent_conversations` (migration
017, linha 108). Executor incrementa a cada flush (executor.ts:1066).
Nenhum check em produto usa esse campo. Nem o cost-limits (que olha
`agent_usage_daily` e `agent_runs`), nem a UI de ActiveLimitsProgress
(que tambem usa `agent_usage_daily`).

Referencias:

- `apps/crm/supabase/migrations/017_ai_agent_core.sql:108`
- `apps/crm/src/lib/ai-agent/executor.ts:1054`
- `apps/crm/src/lib/ai-agent/executor.ts:1066`

Impacto: e uma metrica orfa. Custa um SELECT + UPDATE a cada flush e nao
serve para nada. Pior: cria a falsa impressao de que existe um ceiling
per-conversation (que seria natural ler dessa coluna).

Recomendacao: ou criar um cost-limit scope `conversation_total` que
consome essa coluna (mais coerente com o nome), ou remover a coluna +
update + select para economizar IO.

### Media - Bug gpt-5 reasoning tokens documentado em memory esta obsoleto

Memory `project_gpt5_reasoning_tokens_bug.md` aponta para
`executor.ts:1645` e helper `buildMaxTokensParam`. Codigo atual:

- executor.ts tem 1123 linhas, linha 1645 nao existe.
- `buildMaxTokensParam` nao existe em nenhum arquivo do repo.
- Sintoma original (Tester respondia HANDOFF_REPLY literal) nao
  reproduz mais — pivot pro flow runner mudou o caminho.

O fix `* 4` aplicado local nao precisa mais ser commitado. Mas a memory
entry deveria ser atualizada para apontar para o achado real atual
(achado #4 desta rodada: ausencia de `max_completion_tokens`).

Recomendacao: atualizar
`memory/project_gpt5_reasoning_tokens_bug.md` para refletir que o bug
mudou de natureza apos PR-FLOW-PIVOT. Acao agora e adicionar cap, nao
ajustar valor de cap inexistente.

## Pontos saudaveis

- `calculateCostUsdCents` esta correto: usa `completion_tokens` que ja
  inclui reasoning_tokens. Audit de custo por run e fiel ao que OpenAI
  bila.
- `agent_runs` registra tokens_input, tokens_output, cost_usd_cents,
  duration_ms — trilha de auditoria por flush.
- `agent_usage_daily` agregado por dia + config_id da observabilidade
  granular.
- UI de LimitsEditor/ActiveLimitsProgress respeita a regra de "token
  economy oculta": mostra utilization percentual sem expor numeros
  brutos ao cliente final.
- Defaults conservadores em clamp* helpers protegem entrada quando user
  passa numero invalido — boa defesa em depth.

## Validacao rodada

Auditoria estatica via grep. Validamos especificamente:

```text
grep -rn "assertWithinCostLimits" apps/crm/src
# -> apenas test + readme + cost-limits.ts (definicao)

grep -rn "shouldTriggerConversationSummarization" apps/crm/src
# -> apenas summarization.ts (definicao). zero callers.

grep -rn "max_completion_tokens\|buildMaxTokensParam" apps/crm/src
# -> zero matches.

grep -rn "history_summary" apps/crm/src/lib/ai-agent/flow/
# -> apenas tester-context.ts (preservacao em transfer_to_agent docstring).
#    zero leitura em runner.
```

Nenhum teste de carga rodado. Recomendamos teste manual: ativar gpt-5
em uma org de staging, anexar doc de 100KB com `knowledge_mode = "full"`,
disparar 10 mensagens em sequencia e medir `agent_runs.cost_usd_cents`
acumulado vs ceiling supostamente configurado em `agent_cost_limits`.
Esperamos ver acumulo passando do ceiling sem bloqueio — confirma o
achado critico #1.

## Ordem de ataque recomendada

1. Adicionar `max_completion_tokens` / `max_tokens` no runner (achado
   #4) — mudanca trivial, alta protecao imediata.
2. Conectar `assertWithinCostLimits` em executeDebouncedBatch (achado
   #1) — protege contra clientes que ja cadastraram limite na UI mas
   nao tem enforcement.
3. Conectar history + summarization no AI node (achados #2 + #3) —
   mesmo PR, mesma migration de comportamento. Critico para UX
   multi-turn, exige mais teste.
4. Hard-cap `full` mode independente de auto (achado #5) — defesa de
   custo contra config errada do cliente.
5. Decidir destino do `tokens_used_total` (achado #6) — implementar
   scope per-conversation OR drop column.
6. Atualizar memory entry sobre o bug gpt-5 obsoleto (achado #7).

## Como casa com auditorias 1-5

Esta rodada complementa a 5 (concorrencia/entrada) cobrindo o eixo
oposto: o que acontece DEPOIS que a mensagem chega no executor. Juntas:

- 5a rodada: protege contra inflar volume de runs via duplicacao.
- 6a rodada: protege contra inflar custo de cada run individual.

A rodada 1 (current_node_id terminal reexecutado) cruza com a 6 porque
um flow preso em action terminal pode disparar runs vazios repetidos —
sem ceiling, isso e custo silencioso por mensagem inbound.

Recomendacao consolidada com a rodada 5: as duas correcoes criticas
juntas (achado 5/critica + 6/critica #1) sao a barreira minima para
ativar `ai_agent_native` em mais orgs. Hoje o sistema confia em
configuracao manual cuidadosa do operador — qualquer engano explode em
volume ou em custo.

---

# Setima auditoria - humanizacao no caminho flow

**Data:** 26/mai/2026
**Escopo refinado:** PR #235-#238 entregaram pausa/resume keyword, picotar
+ delay, horario comercial, biblioteca de midia e auto-pausa por resposta
humana. Toda essa familia foi pensada antes do flow runner (PR-FLOW-PIVOT).
A pergunta da rodada e: tudo isso continua valendo quando
`behavior_mode = "flow"`?

## Caminho auditado

1. `apps/crm/src/lib/ai-agent/executor.ts::tryEnqueueForNativeAgent`
   secao 9b-9c (humanization gate antes do enqueue).
2. `apps/crm/src/lib/ai-agent/executor.ts::executeDebouncedBatch` (load do
   agent_conv no flush).
3. `apps/crm/src/lib/ai-agent/flow/realtime-provider.ts` (picotar + delay
   + setTyping + send-guard inline).
4. `apps/crm/src/lib/ai-agent/send-guard.ts` (last-mile gate).
5. `apps/crm/src/actions/messages.ts::autoPauseNativeAgent` +
   `markConversationHumanOwnedAfterOperatorReply`.
6. `apps/crm/src/actions/conversations.ts::setNativeAgentHandoffForConversation`
   (manual "Assumir IA").
7. `packages/shared/src/ai-agent/humanization.ts` (helpers
   `matchesPauseKeyword`, `matchesResumeKeyword`, `isAutoPauseExpired`,
   `isWithinBusinessHours`, normalizacao).
8. `apps/crm/src/lib/ai-agent/debounce.ts::flushReadyConversations`
   (selecao de candidatos).

## Veredito da setima rodada

O caminho feliz funciona. Pause/resume keyword e horario comercial sao
gateados no `tryEnqueueForNativeAgent` antes do enqueue, picotar + delay
sao aplicados no realtime-provider entre cada chunk, send-guard last-mile
protege envio quando ownership muda. Mas tres caminhos colaterais cruzam
fronteiras de modulo e perdem coerencia:

1. Pausa ativada entre enqueue e flush nao impede o flow de rodar; so o
   envio final e bloqueado.
2. Auto-pausa quando operador responde carrega humanization do agente
   errado em orgs com mais de um agente ativo.
3. Pausa por keyword nao espelha o estado em `conversations.assigned_to`,
   entao a UI nao mostra "AI pausado" depois de "PAUSAR".

## Achados

### Critica - Pausa entre enqueue e flush nao aborta o flow

`flushReadyConversations` seleciona candidatos apenas por `next_flush_at`:

```ts
.from("agent_conversations")
.select("id, organization_id, next_flush_at")
.lte("next_flush_at", now.toISOString())
```

Referencias:

- `apps/crm/src/lib/ai-agent/debounce.ts:75`
- `apps/crm/src/lib/ai-agent/debounce.ts:78`
- `apps/crm/src/lib/ai-agent/executor.ts:893`
- `apps/crm/src/lib/ai-agent/executor.ts:1046`
- `apps/crm/src/lib/ai-agent/send-guard.ts:73`

E `executeDebouncedBatch` carrega o `agent_conv` sem incluir
`human_handoff_at` (linha 895). Resultado:

1. Lead manda msg, webhook enfileira em `pending_messages` + seta
   `next_flush_at = now + debounce_window`.
2. Antes do cron flush rodar, operador abre o chat e responde.
3. `autoPauseNativeAgent` seta `human_handoff_at = now` e bumpa `epoch`.
4. Cron flush pega a conversa (so olha `next_flush_at`), nao ve a pausa.
5. `executeDebouncedBatch` carrega config + flow + provider, chama
   `runFlow`, que chama OpenAI, que retorna tool_calls + texto. Tools
   nativos rodam (add_tag, move_pipeline_stage, set_lead_custom_field,
   create_appointment, transfer_to_user, set_typing, etc).
6. Runner emite `send_text` → realtime-provider chama `canAiSendNow` →
   detecta `human_handoff_active` → bloqueia o envio.

Estado final: lead nao recebe mensagem (correto), mas:

- O LLM foi chamado e cobrado (tokens_input + tokens_output + reasoning
  no caso de gpt-5*).
- Os tool handlers rodaram com side effects no DB (tags aplicadas,
  pipeline_stage movido, custom_field setado, appointment criado).
- `agent_runs` registra o run como `succeeded`, `actions_executed` ganha
  entradas, mas o lead nunca soube de nada.

Impacto: operador assume conversa, e o estado do CRM continua se modificando
"em nome da IA" mesmo apos a pausa. Em UX, o operador ve tags novas e
pipeline movido sem saber por que. Em custo, paga por turn que nao foi
entregue.

Recomendacao:

1. Em `executeDebouncedBatch`, ler `human_handoff_at` junto com o resto
   do agent_conv (linha 895-896). Se setado e nao expirado, abortar o
   flush antes de chamar `runFlow` e marcar pending_messages como
   "skipped_paused".
2. Adicional: filtrar candidatos no flush por `human_handoff_at IS NULL
   OR (auto_pause_minutes > 0 AND now() > handoff + interval)`. Hoje a
   query em debounce.ts:75-80 nao tem esse predicate.

### Alta - `autoPauseNativeAgent` carrega humanization do agente errado

Em messages.ts, o helper carrega humanization assim:

```ts
const { data: agentConfig } = await supabase
  .from("agent_configs")
  .select("humanization_config")
  .eq("organization_id", orgId)
  .eq("status", "active")
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();
```

Referencias:

- `apps/crm/src/actions/messages.ts:46`
- `apps/crm/src/actions/messages.ts:52`
- `apps/crm/src/actions/messages.ts:69`
- `apps/crm/src/lib/ai-agent/executor.ts:534`
- `apps/crm/src/lib/ai-agent/executor.ts:551`

O criterio e "primeiro agente ativo da org, ordenado por created_at". Mas
desde a PR de routing condicional (PR #244, mai/2026), uma conversa pode
estar atendida por:

- Agente principal (`is_primary = true`).
- Agente secundario casado por `pickAgentForLead` baseado em
  segment/keyword/stage.
- Agente "stickiness" preservado por `agent_conversations.config_id`.

`autoPauseNativeAgent` nao consulta `agent_conversations` para descobrir
qual config_id e dono daquela conv. Carrega o "primeiro qualquer", entao:

- Se agente A foi criado primeiro com `auto_pause_minutes = 0` (feature
  off) mas hoje a conv esta com agente B com `auto_pause_minutes = 30`,
  o helper retorna A.config, ve `auto_pause_minutes = 0`, e **retorna
  sem pausar** (linha 66: `if (humanization.auto_pause_minutes <= 0)
  return;`).
- Sintoma: operador responde, agente B continua respondendo em paralelo
  como se nada tivesse acontecido, ate o send-guard last-mile detectar
  troca de ownership.

Mas note que o codigo, depois de carregar o config errado, faz UPDATE em
**todas** as agent_conversations daquela crm_conversation_id (linha
69-93). Se a humanization carregada permite pausa, ele pausa todas
corretamente. O bug e so na decisao de pausar OU NAO, baseado na config
errada.

Impacto: variavel por org. Orgs com 1 agente ativo: zero impacto. Orgs
com multi-agente: comportamento de auto-pausa intermitente conforme qual
agente foi criado primeiro.

Recomendacao: trocar o load por `JOIN agent_conversations
ON config_id` filtrando pelo `crm_conversation_id` atual:

```ts
const { data: rows } = await supabase
  .from("agent_conversations")
  .select("id, config_id, human_handoff_at, ai_control_epoch, agent_configs!inner(humanization_config)")
  .eq("organization_id", orgId)
  .eq("crm_conversation_id", conversationId);
```

E iterar avaliando humanization por linha. Cada agent_conv usa sua propria
config.

### Alta - Tools nativos rodam mesmo com `human_handoff_active`

Consequencia direta do achado critico #1 acima, mas vale destacar
separadamente porque o impacto e em **estado do CRM**, nao so em
mensagens perdidas.

Referencias:

- `apps/crm/src/lib/ai-agent/flow/runner.ts:419`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:467`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:541`

Tools que executam dentro do loop do AI node (entre LLM ping-pongs) nao
checam `canAiSendNow`. So o `send_text` final passa pelo guard. Tools
identificados como afetados na 4a rodada (add_tag, move_pipeline_stage,
set_lead_custom_field, etc) hoje nem funcionam por falta de `db`
injection. Mas quando essa correcao chegar (achado da rodada 4), o
problema piora: a tool roda, modifica DB, e nem o lead nem o operador
sabem por que.

Recomendacao: passar o mesmo `sendGuard` que o realtime-provider usa para
o `FlowRunContext`, e checar `canAiSendNow` no inicio de
`executeAIAgentNode` e no inicio de `executeActionNode`. Se bloqueado,
emitir `kind: "guardrail"` event e abortar o run com
`fatal_error = "human_handoff_active"`.

### Media - Pause keyword nao atualiza `conversations.assigned_to`

Quando lead manda "PAUSAR" (matchPause em executor.ts:676):

```ts
await db
  .from("agent_conversations")
  .update({
    human_handoff_at: new Date().toISOString(),
    human_handoff_reason: "pause_keyword",
    ai_control_epoch: aiControlEpoch + 1,
  })
  ...
return { handled: true, status: "paused_by_keyword", ... };
```

Referencias:

- `apps/crm/src/lib/ai-agent/executor.ts:686`
- `apps/crm/src/lib/ai-agent/executor.ts:694`
- `apps/crm/src/actions/messages.ts:104`
- `apps/crm/src/actions/conversations.ts:9`

Mas operador respondendo via chat (messages.ts:236) tambem chama
`markConversationHumanOwnedAfterOperatorReply` que atualiza
`conversations.assigned_to = userId, status = waiting_human`. E o botao
manual "Assumir IA" (conversations.ts:18) tambem ajusta os dois lados.

So o pause keyword pula essa atualizacao. Resultado:

- Lead PAUSAR → `agent_conversations.human_handoff_at` setado, mas
  `conversations.assigned_to = "ai"` e `status = "active"`.
- Chat-window mostra a conv como "AI assigned" (porque le `assigned_to`),
  e o operador supoe que IA continua respondendo.
- Send-guard impede IA de responder, entao lead fica em silencio.
- Operador eventualmente percebe que lead nao foi respondido e digita
  manualmente — so agora `assigned_to` muda.

Impacto: lead em silencio + operador sem visibilidade do que aconteceu.
O `human_handoff_reason = "pause_keyword"` esta no DB mas a UI nao
expoe.

Recomendacao: depois de matchPause, atualizar tambem
`conversations.assigned_to = "queue"` (ou um marcador especial tipo
`"paused_by_lead"`) + `status = "waiting_human"`. Adicionar coluna ou
banner na UI explicando "Lead pediu pausa via keyword X". Padrao
consistente com matchResume (que ja atualiza ambos os lados).

### Media - `matchesPauseKeyword`/`matchesResumeKeyword` so fazem match EXATO

`normalizeKeyword` apenas faz `.trim().toUpperCase()`. Sem unaccent,
sem fuzzy, sem `includes`.

Referencias:

- `packages/shared/src/ai-agent/humanization.ts:372`
- `packages/shared/src/ai-agent/humanization.ts:447`
- `packages/shared/src/ai-agent/humanization.ts:461`

Defaults: `["PAUSAR", "HUMANO", "STOP IA"]` e `["ATIVAR", "IA ON",
"VOLTAR IA"]`.

Casos que NAO disparam:
- "pausa" (singular)
- "parar a ia"
- "stop"
- "pausa pra mim"
- "humano por favor"
- "ativar a IA" (frase, nao exato)

Tipico em conversa real, lead escreve frase, nao palavra-chave isolada.
A feature funciona como "comando" simbolico, mas nao como "expressao de
intencao".

Impacto: nao quebra nada, so falha em ser util. UX da feature e
"escondida" — depende de lead ja saber a palavra.

Recomendacao: trocar `includes(normalized)` por `some(k =>
normalized.includes(k))`. Risco: false positives ("nao pausar" vai
disparar PAUSAR). Alternativa: regex com word-boundary e unaccent
(`\bPAUSAR\b` em normalized sem acento). Decisao de produto, nao de
codigo apenas.

### Baixa - Documentacao stale em humanization.ts sobre split

```ts
// PR B (mai/2026): split de respostas longas pra parecer mais humano.
// Quando split_enabled = true E reply >= threshold_chars, executor pede
// ao GPT pra cortar em N mensagens curtas (lib/ai/message-splitter) e
// envia uma por vez com setTyping + delay entre elas. Default off por
// conservadorismo — split usa 1 chamada OpenAI extra (~$0.0001 por
// resposta longa, mas o cliente paga plano fixo).
```

Referencias:

- `packages/shared/src/ai-agent/humanization.ts:29`
- `apps/crm/src/lib/ai-agent/flow/realtime-provider.ts:47`

Implementacao atual em realtime-provider.ts:47-64 e chunking
deterministico por whitespace (\n\n > \n > ". " > " "). Nao chama
OpenAI. Comentario referencia codigo que nao existe mais ou nunca
existiu para o flow runner.

Impacto: leitor da codebase acha que paga ~$0.0001 extra por resposta
longa. Operador de custo acredita em despesa que nao existe.

Recomendacao: atualizar o comentario para refletir o chunking
deterministico atual. Mencionar que e zero-cost.

### Baixa - Asimetria matchPause vs matchResume vs manual assumir

Tres caminhos pausam de jeitos diferentes:

| Origem | Atualiza agent_conv | Atualiza conversations | Bumpa epoch |
| --- | --- | --- | --- |
| Lead PAUSAR | sim (handoff + reason) | nao | sim |
| Operador reply | sim (autoPauseNativeAgent) | sim (markConversationHumanOwned) | sim |
| Botao "Assumir IA" | sim (setNativeAgentHandoff) | sim | sim |
| Lead ATIVAR | sim (limpa handoff) | sim (assigned_to=ai+active) | sim |

Pause keyword e o unico assimetrico. Resume keyword corrige
`conversations` mas o pause keyword nao corrompe a entrada — apenas
"esquece" de marcar o outro lado.

Recomendacao: padronizar todos os caminhos via um helper unico
`applyPauseTransition(orgId, agent_conv_id, source, opts)` que sempre
atualiza ambas as tabelas + bumpa epoch + grava reason. Hoje a logica
ta espalhada em 3 arquivos.

## Pontos saudaveis

- `realtime-provider.ts` aplica picotar + delay + setTyping
  deterministicamente. `humanization.split_threshold_chars` respeitado.
  Chunks que falham middle-way abortam o resto (linha 198).
- Send-guard last-mile checa `assigned_to`, `status`, `human_handoff_at`
  e `ai_control_epoch` antes de cada chunk. Ordering correto: ownership
  primeiro, depois epoch (linha 52-83).
- Resume keyword bumpa epoch + restaura assigned_to (executor.ts:650-675).
- Manual "Assumir IA" e idempotente (NULL guard em autoPauseNativeAgent
  linha 78).
- Business hours sao avaliados no horario do enqueue, com cooldown de
  after_hours_message para nao spammar lead. `shouldSendAfterHoursMessage`
  controla a frequencia.
- Auto-pausa expira corretamente baseada em `auto_pause_minutes`. Quando
  expira, limpa e segue.

## Validacao rodada

Auditoria estatica. Validamos especificamente:

- O caminho do pause keyword: webhook chega → executor.ts:648-704 →
  retorna `handled=true status=paused_by_keyword`. Pending_messages nao
  e enfileirado. Mais nada acontece. ✓
- O caminho do operator reply: messages.ts:236-241 chama
  autoPauseNativeAgent + markConversationHumanOwned em paralelo. Ambos
  best-effort. ✓
- O caminho do send-guard mid-flow: realtime-provider.ts:103-118 chama
  canAiSendNow antes de cada chunk. Aborta entre chunks. ✓

Teste recomendado para a critica #1:

```bash
# Em staging, com tester ativo:
# 1. Lead manda msg, espera ate ver pending_messages com next_flush_at.
# 2. Antes do cron pegar (15s tipico), operador responde via chat-window.
# 3. Verificar:
#    - agent_runs (deve ter 1 run com status=succeeded mesmo nao
#      tendo entregue).
#    - lead_tags (se o flow tinha add_tag, tag foi aplicada mesmo).
#    - messages outbound (sender=ai) deve estar VAZIO.
#    - agent_steps deve mostrar tool_call=add_tag success + send_text
#      depois com skipped=ai_send_blocked.
```

Se a coluna `actions_executed_detail` mostra entradas mas `messages`
nao tem outbound, e o achado critico reproduzido.

## Ordem de ataque recomendada

1. **Critica** - Filtrar flush por `human_handoff_at` (mudanca em duas
   queries em debounce.ts:75 + executor.ts:893). Aborta toda a familia
   de problemas pos-pausa.
2. **Alta** - Corrigir `autoPauseNativeAgent` para carregar humanization
   por config_id da conversa. Migration nao precisa, so query.
3. **Alta** - Estender `canAiSendNow` para gatear tools nativos no
   `executeActionNode`, nao so o `send_text`. Pequena refactor.
4. **Media** - Padronizar pause keyword: atualizar
   `conversations.assigned_to` quando matchPause dispara. Helper
   `applyPauseTransition` consolida 3 caminhos.
5. **Media** - Decidir produto da match (exato vs fuzzy). Pequena
   mudanca em matchesPauseKeyword/matchesResumeKeyword.
6. **Baixa** - Atualizar comentario stale em humanization.ts sobre split.

## Como casa com auditorias 5 e 6

- Rodada 5: cobre **entrada** (webhook). Esta cobre **handoff midstream**
  (entre webhook enqueue e flush). Juntas, tres pontos no tempo onde
  ownership/concorrencia podem dar conflito: enqueue, flush start,
  flush end.
- Rodada 6: descobriu que ceiling de custo nao e enforced. Esta rodada
  agrava: pausa entre enqueue e flush gasta tokens DO MESMO JEITO. Se
  ceiling estivesse enforced, pelo menos consumo seria visivel; sem
  ceiling, e custo silencioso.
- Rodada 4: action handlers sem `db` injection. Quando isso for
  corrigido, tools comecarao a rodar de verdade. Sem o gating proposto
  no achado #3 desta rodada, tools rodarao tambem durante pausas.

Recomendacao consolidada das 3 ultimas: tratar o achado critico #1
desta rodada como pre-requisito de qualquer expansao do ai_agent_native.
Hoje a pausa funciona "no papel" (send-guard bloqueia envio), mas mente
ao operador sobre o que aconteceu enquanto pausado.

---

# Oitava auditoria - knowledge injection (PR #351) x flow runner

**Data:** 26/mai/2026
**Escopo refinado:** PR #351 entregou knowledge inject hibrida (full/rag/auto).
A rodada 6 ja sinalizou re-injecao em `full` mode como risco de custo.
Esta rodada aprofunda a interacao: RAG cache, threshold em bytes vs
tokens, indice DB, paridade tester.

## Achados

### Critica - `full` mode sem hard-cap quando user escolhe manual

Repetido aqui porque foi reverificado em detalhe e merece reforco: o
threshold de 30KB (`AUTO_FULL_BYTES_THRESHOLD`) so se aplica em modo
`auto`. Cliente forcando `full` em UI ignora o cap.

Referencias:

- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:41`
- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:99`
- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:115`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:260`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:294`

Impacto: doc de 150KB = ~40k tokens injetados por turn em gpt-5
(input ~5 cents). Sem cache. Re-injecao a cada AI node (multi-node
flows multiplicam).

Recomendacao consolidada com rodada 6 achado #5: hard-cap 30KB
independente do modo + cache materializado por
`(config_id, sources_hash)` invalidado so quando indexing job conclui
nova source.

### Alta - RAG re-busca top-k a cada turn sem cache por query_hash

`buildRagModeBlock` chama `retrieveWithAttempt` em todo AI node, usando
`ctx.inboundMessage.text` cru. Embedding Voyage + pgvector distance
custam ~1.5ms cada, fora o custo da API Voyage ($0.18/1M tokens). Sem
memoizacao por `(config_id, query_hash)`.

Referencias:

- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:43` (RAG_TOP_K=3)
- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:180`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:260`
- `apps/crm/src/lib/ai-agent/rag/retriever.ts:68` (RAG_DISTANCE_CEILING=0.75)
- `packages/shared/src/ai-agent/rag.ts:84`

Impacto: lead escreve "oi" → retrieval; lead escreve "oi" de novo →
retrieval. Latencia + custo Voyage. Em queries genericas, top-3 nao e
deterministico (cosine distance bate threshold com varios chunks
similares), entao o prompt muda turn-a-turn sem motivo de produto.

Recomendacao: memo em FlowRunContext OR cache `(config_id,
sha1(query_text), interval=5min)`. Ou simplesmente: nao re-buscar se o
inbound nao mudou desde o ultimo turn.

### Alta - `measureKnowledgeBytes` decide modo por BYTES, prompt e contado por TOKENS

A heuristica de 30KB usa `row.content?.length` (bytes UTF-8). Mas o
prompt e consumido pela OpenAI em tokens. Em portugues, 1 token = ~3
caracteres. Entao 30KB ~= 10k tokens (nao 7.5k). Combinado com tools
schema (~3-5KB), agent system_prompt (~1-2KB) e instructions, o
`auto` mode pode escolher `full` em situacoes onde o prompt total ja
explode a janela do gpt-4o-mini (~8k em pratica).

Referencias:

- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:41`
- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:96`
- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:232`

Impacto: clientes em gpt-4o-mini ou gpt-5-mini com doc proximo do
threshold sofrem context-window exhaustion silencioso. OpenAI nao
trunca prompt automaticamente — retorna erro ou comportamento
inconsistente.

Recomendacao: trocar `length` por `tiktoken.encode().length` (ou
tabela aproximada por idioma). Threshold em tokens, nao bytes. Default
6000 tokens.

### Alta - Tester carrega knowledge igual a producao mas reporta `cost_usd_cents: 0`

A action `testAgent`/`testAgentLive` em `actions/ai-agent/tester.ts:223`
chama `runFlow` diretamente. O runner chama
`buildKnowledgeBlock` sem ramificacao por dry_run. Resultado: tester
consome tokens reais OpenAI + Voyage retrieval, mas a resposta da
action zera o campo de custo.

Referencias:

- `apps/crm/src/actions/ai-agent/tester.ts:25`
- `apps/crm/src/actions/ai-agent/tester.ts:223`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:249`

Impacto: admin testa, ve "custo: $0", autoriza workflow. Em producao,
$2/lead. Quebra confianca no tester.

Recomendacao: contabilizar custo do tester como qualquer run (popular
`cost_usd_cents` real). Marcador `is_preview=true` no
`agent_runs.metadata` para diferenciar de runs de producao em
relatorios.

### Media - `agent_knowledge_chunks` sem indice composto para queries do full mode

`buildFullModeBlock` faz `SELECT content, chunk_index, source:agent_knowledge_sources!inner(...)`
filtrando por organization_id + config_id + indexing_status. RPC do RAG
usa pgvector index proprio, mas full mode nao. Org com muitos agentes
e muitos chunks faz seq scan em cada AI node.

Referencias:

- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:122`

Recomendacao: criar `CREATE INDEX idx_chunks_source_chunk ON
agent_knowledge_chunks (source_id, chunk_index)` se ainda nao existe.
Verificar com `\d+ agent_knowledge_chunks` em prod.

## Pontos saudaveis

- `buildKnowledgeBlock` retorna `null` em qualquer erro — IA nunca
  quebra por knowledge ausente. Boa defesa.
- `Promise.all` em `executeAIAgentNode:249` carrega config + tools +
  knowledge em paralelo. Latencia bem otimizada.
- RLS via `eq("source.organization_id", org)` em todas as queries.
- `RAG_DISTANCE_CEILING = 0.75` filtra hits irrelevantes
  ([retriever.ts:68](apps/crm/src/lib/ai-agent/rag/retriever.ts:68)).
- Modo `auto` evita o cliente escolher errado: threshold simples
  decide.

## Como casa com rodadas anteriores

- Rodada 6 #5: confirmado com detalhes tecnicos. Sem cache + sem cap +
  sem token-accurate threshold.
- Rodada 6 #4 (sem max_completion_tokens): amplificado aqui. gpt-5 com
  knowledge 150KB + reasoning sem cap = risco de 50k tokens/turn.

---

# Nona auditoria - versionamento de flow x conversas vivas

**Data:** 26/mai/2026
**Escopo refinado:** o que acontece com conversas vivas
(`agent_conversations.current_node_id` apontando para um node especifico)
quando o admin edita e salva nova versao do flow.

## Achados

### Critica - `saveFlow` sobrescreve flow sem checar conversas vivas

A action `saveFlow` em `actions/ai-agent/flow.ts:37-102` faz UPDATE de
`nodes` + `edges` + `enabled_tools` na linha do flow (incrementando
`version`), mas NAO verifica se ha `agent_conversations` com
`current_node_id` apontando para nodes removidos/renomeados.

Referencias:

- `apps/crm/src/actions/ai-agent/flow.ts:37`
- `apps/crm/src/actions/ai-agent/flow.ts:62`
- `apps/crm/src/actions/ai-agent/flow.ts:77`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:90`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:92`

Impacto: admin remove node "coleta_idade" do canvas. Lead estava com
`current_node_id = "coleta_idade"`. Proxima mensagem do lead:
- Flush carrega flow novo.
- Runner faz `getNodeById("coleta_idade")` → undefined.
- `result.fatal_error = "node_not_found:coleta_idade"` e
  `executeDebouncedBatch` registra run como `failed`.
- Lead em silencio. Sem retry, sem recovery.

Recomendacao:
1. Antes de salvar, contar
   `SELECT count(*) FROM agent_conversations WHERE config_id=X AND
   current_node_id IS NOT NULL`. Avisar admin "X conversas em
   andamento serao afetadas".
2. No runner, se `node_not_found`, fazer fallback para o entry node
   em vez de hard-fail. Loga `recovery_from_missing_node` event.

### Alta - Loader nao valida `current_node_id` ao carregar flow

`loadFlowByConfigId` em `lib/ai-agent/flow/loader.ts` normaliza JSONB
defensivamente mas nao cruza com `agentConv.current_node_id`. O check
e tardio, no runner.

Referencias:

- `apps/crm/src/lib/ai-agent/flow/loader.ts` (toda a funcao)
- `apps/crm/src/lib/ai-agent/flow/runner.ts:90`

Recomendacao: o loader retorna `{ config, recovery_node_id?: string |
null }`. Se passar `currentNodeId` opcional e nao existir, devolve
recovery sugerido (entry node). Executor decide se aplica.

### Alta - `version` incrementado sem CAS — admins concorrentes perdem edicoes

Comment do proprio codigo: "V1 sem CAS, conflict resolution e 'last
write wins'" ([flow.ts:31-32](apps/crm/src/actions/ai-agent/flow.ts:31)).

Cenario: admin A e admin B abrem o canvas no mesmo momento.
1. Ambos veem `version=5`.
2. A edita "Coleta idade → Move etapa" e salva → `version=6`.
3. B edita "Move etapa → Envia mensagem" (sem ver mudanca de A) e
   salva → query UPDATE escreve `version=6` (sobrescreve A).
4. Sem detec¸ao de conflito. A perde mudancas silenciosamente.

Referencias:

- `apps/crm/src/actions/ai-agent/flow.ts:31`
- `apps/crm/src/actions/ai-agent/flow.ts:67`
- `apps/crm/src/actions/ai-agent/flow.ts:77`

Recomendacao: implementar CAS via `WHERE version = $expected` no
UPDATE. Se ROW_COUNT=0, retorna erro 409 "Conflict — reload e tente
novamente". UI mostra modal com diff.

### Alta - Executor salva `current_node_id` em action/condition terminal

Reiteracao da rodada 1 (achado critico). Confirmado em
`executor.ts:1064`: `current_node_id = result.ending_node_id` sem
diferenciar tipo do node.

Referencias:

- `apps/crm/src/lib/ai-agent/executor.ts:1046`
- `apps/crm/src/lib/ai-agent/executor.ts:1064`
- migracao `054_ai_agent_flow_pivot.sql:22` (documento referente)

Combina com achado critico desta rodada: ao reexecutar action terminal,
se aquele node tambem foi removido na ultima edicao, o erro vira
duplo — primeiro reexecuta (rodada 1), depois falha por node_not_found
(esta rodada). Cliente ve comportamento erratico sem causa clara.

Recomendacao: ao salvar ending_node_id, checar `node.type`. Se
`action` ou `condition`, setar `current_node_id = null` em vez do
node terminal.

### Media - Pivot legacy → flow nao limpa `actions_executed` antigo

Migration 054 forca `behavior_mode = 'flow'` em todas as conversas
existentes, mas mantem `actions_executed` (array legado) e
`actions_executed_detail` (PR #265). Conversas migradas carregam
estado misto: `current_stage_id` foi convertido em `current_node_id`,
mas `actions_executed[]` ainda contem stage names antigos que nao
existem mais.

Referencias:

- `apps/crm/supabase/migrations/054_ai_agent_flow_pivot.sql:63`
- `apps/crm/supabase/migrations/054_ai_agent_flow_pivot.sql:94`

Impacto: scripts/queries que dependem de `actions_executed` para
deduplicar acoes nao reconhecem as entradas antigas. Auditoria fica
inconsistente.

Recomendacao: na migration 054 (ou em script de cleanup separado),
resetar `actions_executed = '[]'` quando a conversa nao tem
`current_node_id` correspondente no flow novo.

### Media - UI nao mostra alerta de "X conversas afetadas" antes do save

`FlowCanvas.handleSave` calcula `validationIssues` mas nao bloqueia
salvar invalido (rodada 1). Tambem nao consulta server para alertar
"esta edicao afeta N conversas em andamento".

Referencias:

- `packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx` (handleSave)

Recomendacao: action `previewFlowImpact` que retorna
`{ affected_conversations: number, broken_node_ids: string[] }`. UI
mostra modal de confirmacao antes do save real.

## Pontos saudaveis

- Loader normaliza JSONB defensivamente (`packages/shared` zod schemas
  + fallback safe quando coluna ausente).
- Migration 054 bem documentada com decisoes explicitas (DESTRUTIVO vs
  PRESERVA).
- Runner registra `node_not_found` como `fatal_error` (nao executa
  silencioso).
- RLS policies corretas: SELECT por agent+, INSERT/UPDATE/DELETE por
  owner/admin.
- `saveFlow` valida org/config antes de persistir (protege IDOR).

## Como casa com rodadas anteriores

- Rodada 1: `current_node_id` terminal reexecutado — esta rodada
  agrava porque o node terminal pode tambem ter sido removido.
- Rodada 5: concorrencia em `agent_conversations` — concorrencia em
  `agent_flows` (sem CAS) e o mesmo padrao em outra tabela.

---

# Decima auditoria - paridade Tester (FAB) x WhatsApp real

**Data:** 26/mai/2026
**Escopo refinado:** o tester e fielmente o "sandbox seguro" que o
admin acredita? Se diverge da producao em pontos importantes, da falso
positivo de "agente funciona" e bugs so aparecem em prod.

## Achados

### Alta - Tester bypassa todos os gates do webhook

`testAgent` (legado) e `testAgentLive` em `actions/ai-agent/tester.ts`
chamam `runFlow` diretamente
([tester.ts:93](apps/crm/src/actions/ai-agent/tester.ts:93) e
[tester.ts:223](apps/crm/src/actions/ai-agent/tester.ts:223)). Nao
passam por `tryEnqueueForNativeAgent`. Resultado: o admin testa sem:

- feature flag `ai_agent_native` (executor.ts:293) — tester roda
  mesmo se org tem flag desabilitada.
- check de `primary_agent` ativo (executor.ts:301).
- dedup por `whatsapp_msg_id` (executor.ts:337).
- pause/resume keyword match (executor.ts:648).
- horario comercial (executor.ts:729).
- humanHandoff active check (executor.ts:705).
- debounce window (skipping o flush cron).

Referencias:

- `apps/crm/src/actions/ai-agent/tester.ts:25`
- `apps/crm/src/actions/ai-agent/tester.ts:93`
- `apps/crm/src/actions/ai-agent/tester.ts:223`
- `apps/crm/src/lib/ai-agent/executor.ts:273`

Impacto: admin testa com agente pausado/handoff/feature-off e ve a IA
respondendo. Acredita que esta tudo certo. Coloca em producao e
webhook bloqueia. Diferenca silenciosa.

Recomendacao: replicar gates leves no tester (sem efeitos colaterais).
Validar feature_flag, status do agent_config (active vs paused),
business_hours. Mostrar warning no tester: "Agente ativo? ✓",
"Feature ativada? ✓", etc, antes do prompt.

### Alta - Humanization (picotar/delay/typing) nao aplicada no tester

`createTesterProvider` em `flow/tester-provider.ts` so captura eventos
em memoria (events.push). Nao chama `splitMessage`, nao chama
`setTyping`, nao espera `split_delay_seconds`.

Referencias:

- `apps/crm/src/lib/ai-agent/flow/tester-provider.ts` (toda a funcao)
- `apps/crm/src/lib/ai-agent/flow/realtime-provider.ts:47`
- `apps/crm/src/lib/ai-agent/flow/realtime-provider.ts:153`

Impacto: admin testa resposta de 600 chars com `split_threshold=200,
split_delay=2s`. Tester mostra a mensagem completa imediatamente.
Producao mostra 3 chunks com 2s entre cada. Admin nao consegue prever
ritmo real.

Recomendacao: o stub do tester pode reportar nos events um array
`simulated_chunks` com cada chunk + delay calculado, mesmo sem enviar
de fato. UI renderiza preview com os delays explicitos.

### Alta - Tools nativos executam de verdade no tester (com `dry_run` ignorado)

`runner.ts:603` invoca `directHandlers[tool.name](toolArgs, context)`.
O contexto recebe `dry_run: ctx.dryRun`. Mas a maioria dos handlers
nativos nao olha esse flag — apenas tools com `execution_mode='mcp'`
(runner.ts:634) retornam `{ simulated: true }` em dry_run.

Referencias:

- `apps/crm/src/lib/ai-agent/flow/runner.ts:603` (handlers nativos)
- `apps/crm/src/lib/ai-agent/flow/runner.ts:634` (mcp simulado)
- `apps/crm/src/lib/ai-agent/flow/tester-context.ts:18` (lead determ.)

Hoje a maioria dos handlers nativos esta quebrada por falta de `db`
injection (rodada 4). Quando isso for corrigido, tools nativas
modificarao DB REAL durante testes:
- `add_tag` aplica tag no lead determinístico do tester.
- `move_pipeline_stage` move o lead determ.
- `set_lead_custom_field` muta campo.
- `create_appointment` cria appointment.

Lead determinístico (`testerPhoneForOrg`) e reusado entre runs, entao
state vaza turn-a-turn.

Recomendacao: passar `dry_run` para os handlers nativos. Cada handler
verifica e retorna `{ success: true, output: { simulated: true } }`
sem mutacao quando dry_run. Ou: tester usa um schema isolado (RLS
extra) com cleanup automatico.

### Media - Custo do tester e zerado embora consuma OpenAI + Voyage real

`testAgentLive` retorna `cost_usd_cents: 0` hardcoded
(actions/ai-agent/tester.ts:~104). Mas runner chama
`chat.completions.create` real (sem dry_run), `buildKnowledgeBlock`
real, embeddings Voyage real.

Referencias:

- `apps/crm/src/actions/ai-agent/tester.ts:104` (aprox.)
- `apps/crm/src/lib/ai-agent/flow/runner.ts:344`
- `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:62`

Impacto: admin testa 50 mensagens, ve "custo: $0", aprova. Producao
real ate 5x ja consumiu varios centavos em embeddings + tokens. Quebra
da regra "token economy oculta da UI cliente" — pelo menos para o
admin tecnico deveria ser visivel.

Recomendacao: contabilizar custo do tester normalmente em
`agent_runs.cost_usd_cents`. Adicionar marcador `is_preview = true`
no metadata para nao poluir cost-limits (achado da rodada 6).

### Media - Bug #7 (IA aluciona agendamento) so reproduz em producao por causa do bypass de gates

Memory documenta o Bug #7 como "IA responde 'Agendei' mas nao chama
create_appointment". O bug surgiu em sessao live de prod, nao no
tester. Os 3 bypasses anteriores (gates, humanization, tools) explicam
porque: no tester, o admin ve a IA responder ALGO, mas nao consegue
ver se aquilo foi seguido por uma chamada `create_appointment` real
(porque o tool e simulado se for MCP, ou nao executa se for nativo
quebrado da rodada 4).

Referencias:

- `apps/crm/src/lib/ai-agent/README.md` (secao "Bugs conhecidos")
- memory `project_ai_agent_live_test_session.md`

Impacto: padrao de bug "tester verde, prod vermelho". Cliente perde
confianca no produto.

Recomendacao: smoke test em prod (com lead real, conexao real) para
toda feature nova de tool. Tester e bom pra debugar lógica de flow,
nao paridade comportamental.

## Pontos saudaveis

- `ensureTesterContext` preserva state entre runs (paridade
  comportamental do estado: `current_node_id`, `variables`,
  `actions_executed_detail`).
- Lead determinístico (`testerPhoneForOrg`) garante que o admin sempre
  testa contra o mesmo "fake lead", evitando criar leads novos por
  ciclo.
- `tester-provider` e `realtime-provider` capturam eventos no mesmo
  shape (audit em `agent_steps` paridade).
- Tool sanitizer (`stripToolCallLeaks`) roda em ambos os caminhos.
- Status codes (`ok`, `skipped`, `error`) tem mesma semantica.

## Como casa com rodadas anteriores

- Rodada 5 (concorrencia): tester nao reproduz race condition de
  webhook paralelo, entao bugs so aparecem em prod.
- Rodada 6 (custo): tester confirma o $0 falso, e o fato de
  knowledge/embeddings rodarem real torna isso um custo invisivel.
- Rodada 7 (humanizacao): humanization bypass amplifica gap entre
  tester e producao. Admin nao consegue ajustar split_threshold/delay
  iterativamente.
- Rodada 4 (handlers sem db): quando handlers forem corrigidos, tester
  comeca a modificar DB de verdade — vira urgente o `dry_run` real
  por handler.

---

# Resumo executivo apos 10 rodadas

Quatro auditorias do Codex (rodadas 1-4) cobriram a estrutura interna
do canvas e do runner. Seis auditorias adicionais (rodadas 5-10)
cobriram a superficie em volta:

| Rodada | Foco | Severidade maxima |
| --- | --- | --- |
| 1 | Estrutura base, current_node_id terminal | Alta |
| 2 | Paridade Admin/CRM + contratos | Alta |
| 3 | Riscos funcionais (blank, emit_event) | Alta |
| 4 | Matriz por acao (handlers sem db) | Critica |
| 5 | Webhook, dedup, concorrencia | Critica |
| 6 | Custo/token economy/ceiling | Critica |
| 7 | Humanizacao x flow | Critica |
| 8 | Knowledge injection x flow | Critica |
| 9 | Versionamento x conversas vivas | Critica |
| 10 | Paridade Tester x producao | Alta |

Padrao recorrente: features novas (humanizacao, knowledge, routing,
flow) foram entregues isoladamente. As interfaces entre elas nao foram
auditadas. Quase todo achado critico cabe em uma das classes:

1. **Enforcement nao acontece** — codigo existe, e testado, mas
   ninguem chama (cost-limits, summarization).
2. **Estado nao se propaga** — pause em uma tabela, ownership em outra
   (matchPause vs conversations.assigned_to).
3. **Idempotencia inexistente** — UNIQUE constraints faltando
   (agent_conversations), CAS faltando (agent_flows.version).
4. **Contexto nao passa** — handlers sem db, runner sem history,
   tester sem gates.

Acao recomendada: PR de "barreira minima" agregando os achados
criticos de cada rodada (5#critica, 6#critica#1, 7#critica, 9#critica)
em uma unica entrega antes de qualquer expansao da feature flag
`ai_agent_native`.

---

# PLANO CERTEIRO — 6 PRs de barreira + backlog

**Data do plano:** 26/mai/2026
**Premissa:** ai_agent_native (`organizations.settings.features.native_agent_enabled`)
hoje esta OFF por default. A barreira destrava ativar em mais orgs sem
risco de duplicacao, custo descontrolado, ou estado corrompido.

## Diagnostico em uma frase

Em 14 rodadas (4 Codex + 10 nossas) foram identificados ~50 achados,
dos quais ~12 sao criticos. **Quatro deles, juntos, sao a barreira:**
concorrencia (R5), custo sem ceiling (R6), pausa nao aborta flow (R7) e
node terminal reexecutado (R1). Os outros 8 sao de produto/UX e podem
seguir por trilha paralela.

## Grafo de dependencias

```
PR-1 (UNIQUE + race) ──┬──► PR-3 (Flush filter + tool guard)
                       ├──► PR-2 (Cost ceiling + max_tokens)
                       ├──► PR-4 (Node terminal + UI gate)
                       └──► PR-5 (Handlers nativos + db)
                              │
                              └──► (depende de PR-3 pra gating)

PR-6 (emit_event + blank) ── independente, paralelo
```

PR-1 e foundation porque sem UNIQUE qualquer outro fix roda 2x sob
concorrencia. PR-2, 3, 4 podem ser feitos em paralelo apos PR-1. PR-5
depende de PR-3 (o guard de pausa em tools).

## PR-1 — Idempotencia em `agent_conversations`

**Endereca:** R5 #critica + R5 #alta (23505 no insert), R5 #alta (lead
INSERT no caminho nativo).

**Migration nova** `apps/crm/supabase/migrations/070_agent_conv_uniq.sql`:

```sql
-- 1. Dry-run log: detectar duplicatas e gravar em tabela de auditoria
--    antes de qualquer DELETE. Revisao manual ANTES de aplicar cleanup.
CREATE TABLE IF NOT EXISTS public.agent_conversations_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  crm_conversation_id UUID NOT NULL,
  duplicate_id UUID NOT NULL,
  kept_id UUID NOT NULL,
  reason TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

WITH ranked AS (
  SELECT id, organization_id, lead_id, crm_conversation_id,
         row_number() OVER (
           PARTITION BY organization_id, lead_id, crm_conversation_id
           ORDER BY (current_node_id IS NOT NULL) DESC, updated_at DESC
         ) AS rn,
         first_value(id) OVER (
           PARTITION BY organization_id, lead_id, crm_conversation_id
           ORDER BY (current_node_id IS NOT NULL) DESC, updated_at DESC
         ) AS kept
  FROM agent_conversations
  WHERE crm_conversation_id IS NOT NULL
)
INSERT INTO public.agent_conversations_merge_log
  (organization_id, lead_id, crm_conversation_id, duplicate_id, kept_id, reason)
SELECT organization_id, lead_id, crm_conversation_id, id, kept, 'pr1_dry_run'
FROM ranked WHERE rn > 1;

-- 2. UNIQUE partial (preserva linhas legacy onde crm_conversation_id e null)
--    Aplicada APENAS apos revisao do merge_log + DELETE manual das
--    duplicatas. Se duplicatas ainda existirem, esta CREATE falha — sinal
--    pra rever antes.
CREATE UNIQUE INDEX agent_conversations_org_lead_crm_uniq
  ON agent_conversations (organization_id, lead_id, crm_conversation_id)
  WHERE crm_conversation_id IS NOT NULL;

-- 3. R8 #5 — indice composto pra acelerar buildFullModeBlock no
--    knowledge-injector. Cobre o JOIN org+config em agent_knowledge_chunks
--    via agent_knowledge_sources.
CREATE INDEX IF NOT EXISTS idx_chunks_source_chunk
  ON public.agent_knowledge_chunks (source_id, chunk_index);

-- 4. R9 #5 — cleanup de actions_executed legado em conversas migradas
--    pelo pivot 054. Stage names antigos nao existem mais como nodes;
--    actions_executed_detail (PR #265) e o array vigente. Limpa o
--    legado pra evitar dedup confuso em scripts/queries futuros.
UPDATE public.agent_conversations
SET actions_executed = '[]'::jsonb
WHERE actions_executed IS NOT NULL
  AND jsonb_array_length(actions_executed) > 0
  AND (
    -- so limpa conversas que ja migraram (tem current_node_id ou
    -- actions_executed_detail nao vazio)
    current_node_id IS NOT NULL
    OR actions_executed_detail::text <> '{}'
  );
```

**Codigo** em `apps/crm/src/lib/ai-agent/executor.ts`:

- Linha ~360: adicionar `23505` catch no lead INSERT (espelhar
  incoming-pipeline.ts:118-126).
- Linha ~583: adicionar `23505` catch no agent_conversations INSERT
  com re-SELECT pelo (org, lead, crm_conversation_id).
- Linha ~864: separar catch externo em dois niveis. Pre-creacao do
  agent_conversations → handled=false (fallback legacy). Pos-creacao →
  handled=true status="native_error" (deixa cron flush retentar).

**Testes:** existe `ai-agent-routing-stickiness.test.ts`. Adicionar
caso "2 webhooks paralelos do mesmo lead + msg id distinto → 1 row".

**Rollout:** aplicar migration em staging, monitorar
`SELECT count(*) FROM agent_conversations GROUP BY (org, lead, crm_conv)
HAVING count(*) > 1` antes e depois.

**Escopo:** 1 migration + ~80 LOC + 1 teste. ~1 dia.

## PR-2 — Cost ceiling enforcement + max_completion_tokens

**Endereca:** R6 #critica #1 (assertWithinCostLimits dead code), R6
#alta #4 (sem max_completion_tokens), R6 #alta #5 (hard-cap full mode).

**Codigo:**

`apps/crm/src/lib/ai-agent/flow/runner.ts:344`:

```ts
const maxTokensKey = model.startsWith("gpt-5") ? "max_completion_tokens" : "max_tokens";
completion = await client.chat.completions.create({
  model,
  messages,
  [maxTokensKey]: 4096,  // DECISAO: valor default — ver final do plano
  ...(openaiTools.length > 0 ? { tools: openaiTools, tool_choice: "auto" } : {}),
});
```

`apps/crm/src/lib/ai-agent/executor.ts` (em executeDebouncedBatch, apos
carregar agentConfig e antes do runFlow):

```ts
await assertWithinCostLimits({
  db, orgId, configId: agentConfig.id,
  agentConversationId: agentConv.id,
  tokensSoFarRun: 0, costSoFarRunUsdCents: 0,
});
```

E dentro do `executeAIAgentNode`, apos cada `chat.completions.create`,
checar ceiling acumulado. Se lancar `GuardrailError`, marcar
`result.fatal_error = "cost_ceiling"` e retornar gracefully.

`apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts:99`:

```ts
// Hard-cap unificado: aplica mesmo em 'full' manual, nao so 'auto'
const HARD_CAP_BYTES = 30 * 1024;
if (mode === "full") {
  const totalBytes = await measureKnowledgeBytes(db, organizationId, configId);
  if (totalBytes > HARD_CAP_BYTES) mode = "rag";
}
```

**Testes:** `ai-agent-pr4-runtime.test.ts` ja tem testes de
assertWithinCostLimits. Adicionar 1 caso "runFlow para quando ceiling
estoura mid-iteration".

**Escopo:** ~120 LOC. ~1 dia. Decisao pendente: valor default de
max_completion_tokens (sugiro 4096).

## PR-3 — Pausa aborta flow + guard em tools nativos

**Endereca:** R7 #critica (pausa entre enqueue e flush nao aborta) e R7
#alta #3 (tools rodam mesmo com handoff active).

**Codigo:**

`apps/crm/src/lib/ai-agent/debounce.ts:75`:

```ts
const { data: candidateRows } = await params.db
  .from("agent_conversations")
  .select("id, organization_id, next_flush_at, human_handoff_at")
  .lte("next_flush_at", now.toISOString())
  .is("human_handoff_at", null)  // <-- filtra handoff ativo
  .order("next_flush_at", { ascending: true })
  .limit(maxConversations);
```

`apps/crm/src/lib/ai-agent/executor.ts:895` (load do agentConv no
flush): incluir `human_handoff_at` e abortar antes de `runFlow` se
setado e nao expirado.

`apps/crm/src/lib/ai-agent/flow/runner.ts`: passar o `sendGuard` que
hoje so o realtime-provider conhece para o `FlowRunContext`. No
inicio de `executeAIAgentNode` e `executeActionNode`, chamar
`canAiSendNow`. Se bloqueado, emitir `kind: "guardrail"` e abortar com
`fatal_error = "human_handoff_active"`.

**Testes:** `ai-agent-send-guard.test.ts` existe — adicionar 2 casos:
"handoff setado durante o flush" e "handoff setado entre tool calls".

**Escopo:** ~150 LOC. ~1 dia.

## PR-4 — Node terminal + UI gate + autoPauseNativeAgent fix

**Endereca:** R1 #1 (current_node_id em terminal), R1 #2 (handleSave
nao bloqueia), R7 #alta #2 (autoPauseNativeAgent carrega config
errada).

**Codigo:**

`apps/crm/src/lib/ai-agent/executor.ts:1064`:

```ts
const endingNode = getNodeById(ctx.flowConfig, result.ending_node_id);
const isTerminal = endingNode?.type === "action" || endingNode?.type === "condition";
const persistedNodeId = isTerminal ? null : result.ending_node_id;

await db
  .from("agent_conversations")
  .update({
    current_node_id: persistedNodeId,
    last_interaction_at: new Date().toISOString(),
    tokens_used_total: prevTotal + totalTokensTurn,
  })
  ...
```

`packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx::handleSave`:

```ts
const errors = validationIssues.filter(i => i.severity === "error");
if (errors.length > 0) {
  // bloqueia save + abre painel de erros com foco no primeiro
  setShowValidationPanel(true);
  return;
}
await saveFlow(...);
```

**Adicional R3 #5** — validar erro (nao warning) quando entry e evento
CRM e o alvo imediato e ai_agent:

`packages/shared/src/ai-agent/flow-validation.ts:140`:

```ts
// trocar severity de 'warning' pra 'error' quando
// entry.data.trigger in ('pipeline_stage_entered', 'segment_entered')
// e o proximo node imediato e do tipo 'ai_agent'.
// Inbound text vazio nesses casos → AI node skipa sem mensagem,
// flow morre silencioso.
if (
  (entry.data.trigger === "pipeline_stage_entered" ||
   entry.data.trigger === "segment_entered") &&
  nextNode?.type === "ai_agent"
) {
  issues.push({
    severity: "error",
    code: "crm_event_to_ai_direct",
    message: "Eventos do CRM (etapa/segmento) precisam de uma acao antes do node de IA",
    node_id: nextNode.id,
  });
}
```

`apps/crm/src/actions/messages.ts::autoPauseNativeAgent`:

```ts
// Trocar load do "primeiro agent_config ativo" por JOIN com agent_conversations
const { data: rows } = await supabase
  .from("agent_conversations")
  .select("id, config_id, human_handoff_at, ai_control_epoch, agent_configs!inner(humanization_config)")
  .eq("organization_id", orgId)
  .eq("crm_conversation_id", conversationId);

for (const row of rows ?? []) {
  const humanization = normalizeHumanizationConfig(row.agent_configs.humanization_config);
  if (humanization.auto_pause_minutes <= 0) continue;
  // ... rest, agora por linha
}
```

**Testes:** novo arquivo `flow-runner-terminal.test.ts` com caso
"flow termina em send_whatsapp_message → current_node_id = null".
`messages.test.ts` (se existir) adiciona caso multi-agent.

**Escopo:** ~200 LOC. ~1 dia.

## PR-5 — Handlers nativos com `db` injection

**Endereca:** R4 #critica (handlers sem `db` injection).

**Codigo:**

Novo helper em `apps/crm/src/lib/ai-agent/flow/handler-context.ts`:

```ts
export function buildNativeHandlerContext(
  db: AgentDb,
  ctx: FlowRunContext,
  extras: { config?: AgentConfig; provider?: WhatsAppProvider; agentConversation?: AgentConversation } = {},
): HandlerContext {
  return {
    db,
    organization_id: ctx.organizationId,
    lead_id: ctx.leadId,
    crm_conversation_id: ctx.crmConversationId,
    agent_conversation_id: ctx.agentConversationId,
    run_id: ctx.runId ?? null,
    dry_run: ctx.dryRun,
    config: extras.config ?? null,
    provider: extras.provider ?? null,
    agent_conversation: extras.agentConversation ?? null,
  };
}
```

`apps/crm/src/lib/ai-agent/flow/runner.ts:603` (dispatch tool) e
`runner.ts:793` (executeActionNode): trocar a montagem manual de
contexto por `buildNativeHandlerContext(db, ctx, { config, provider, agentConversation })`.

Repassar `config`, `provider` e `agentConversation` do
`executeDebouncedBatch` para `runFlow` via `FlowRunContext`.

**Importante:** `dry_run` agora passa para os handlers nativos. Cada
handler que muta DB deve respeitar — se `dry_run`, retornar
`{ success: true, output: { simulated: true } }` sem mutacao. Isso
resolve tambem o achado R10 #alta #3 (tools nativos rodam no tester).

**Reescrever `transfer_to_agent`** para usar `current_node_id` em vez
de `agent_stages` legado (R4 #critica adicional).

**Decidir `remove_tag` (R1 #3 / R4 matriz)** — duas opcoes:

1. **Implementar handler** `apps/crm/src/lib/ai-agent/tools/remove-tag.ts`:
   espelha `add-tag.ts` mas faz DELETE em `lead_tags`. Adicionar entrada
   em `directHandlers` no runner.ts. Esforco: ~50 LOC + 1 teste.
2. **Remover do catalogo** se produto decide que cliente nao precisa.
   Editar `flow-catalogs.ts` para nao listar `remove_tag` + apagar do
   schema de validacao.

Sugestao: **implementar**. Cliente ja ve a opcao na UI; remover gera
regressao percebida. 50 LOC e baixo custo.

**Testes:** `ai-agent-pr4-runtime.test.ts` ja tem cobertura dos
handlers. Re-rodar contra o novo contexto. Adicionar smoke test
"flow termina em add_tag → tag aplicada no DB" e
"flow termina em add_tag com dry_run → tag NAO aplicada".

**Escopo:** ~400 LOC + 5 handlers reauditados + 1 reescrita. ~2-3 dias.

## PR-6 — emit_event coerente + blank template + create_appointment

**Endereca:** R3 #alta #1 (blank sem agent_flows), R3 #alta #2
(template com flow_config nao mescla emit_event), R3 #alta #3 (AI node
manual sem emit_event no allowlist).

**Codigo:**

`apps/crm/src/actions/ai-agent/configs.ts::applyTemplate`:

- Apos criar `emit_event` tool, sempre mesclar em `flowConfig.enabled_tools`
  quando o flow tem AI node com `instructions.length > 0`.
- Se `template_slug === 'blank'`, ainda assim chamar applyTemplate
  para seed minimo (entry + AI vazio).

`apps/crm/src/lib/ai-agent/flow/loader.ts`: na normalizacao, se houver
AI node com instructions e `emit_event` nao estiver em enabled_tools,
auto-incluir (defesa em depth).

Decisao pendente: `create_appointment` como action node — remover do
catalogo do canvas (mantem apenas como tool da IA) OR adicionar form
fields completos (start_at, type_slug, duration). Sugiro **remover do
canvas** porque o use case principal e a IA chamar a tool com data
coletada do lead.

**Escopo:** ~150 LOC. ~1 dia.

## Ordem de execucao recomendada

| Dia | PR | Pode rodar em paralelo? |
| --- | --- | --- |
| 1 | PR-1 (UNIQUE + races) | nao — foundation |
| 2 | PR-2 (cost ceiling) | sim, com PR-3 e PR-4 |
| 2 | PR-3 (pausa + guard) | sim, com PR-2 e PR-4 |
| 2 | PR-4 (terminal + UI gate) | sim, com PR-2 e PR-3 |
| 3-4 | PR-5 (handlers + db) | depende de PR-3 |
| qualquer | PR-6 (emit_event) | independente, pode subir antes |

Total realista: **5-6 dias** de trabalho focado por quem conhece a
codebase, mais 2 dias de teste em staging.

## Rollout

1. Cada PR em staging primeiro. Smoke test com lead real determinístico
   por org.
2. Apos os 6 mergeados, manter `native_agent_enabled = false` para
   orgs novas. Re-ativar apenas as 3 que ja usam (canary monitorado
   por 48h).
3. Adicionar metrica em `agent_runs`: `failure_reason = "cost_ceiling" |
   "human_handoff_active" | "node_not_found" | "race_lost"`. Painel no
   Admin mostra count por org por dia.
4. Apos 7 dias verde no canary, ativar em mais orgs por convite manual.

## Backlog pos-barreira (ordem de prioridade)

| Item | Endereca | Prioridade |
| --- | --- | --- |
| Knowledge cache por (config_id, sources_hash) | R6 #5 + R8 #1 | Alta |
| History de mensagens + summarization no AI node | R6 #2 + R6 #3 | Alta (multi-turn quebrado) |
| CAS em `agent_flows.version` + UI conflict modal | R9 #3 | Alta |
| `saveFlow` previa "X convs afetadas" | R9 #1 + R9 #5 | Alta |
| Paridade Admin/CRM em configs.ts + flow-catalogs.ts | R2 #1 + R2 #2 + R2 #3 | Media |
| Tester: replicar gates leves + cost real + dry_run handlers | R10 #1 + R10 #2 + R10 #3 | Media |
| `ToolExecutionMode` aceita "mcp" no contrato | R2 #4 | Media |
| matchPause atualiza conversations.assigned_to + helper unificado | R7 #4 + R7 #7 | Media |
| Webhook Meta para fila assincrona (8s timeout n8n) | R5 #media | Media |
| `move_pipeline_stage` salva stage_id + selecao por funil | R3 #media + R4 matriz | Baixa |
| Interpolacao `{{lead.name}}` em set_lead_custom_field | R4 #media | Baixa |
| Drop ou reaproveitar `agent_conversations.tokens_used_total` | R6 #6 | Baixa |
| Comentario stale humanization.ts sobre split GPT | R7 #6 | Baixa |
| Atualizar memory `project_gpt5_reasoning_tokens_bug.md` | R6 #7 | Baixa |
| Threshold de knowledge em tokens (tiktoken) em vez de bytes | R8 #3 | Media |
| Fuzzy/regex em matchesPauseKeyword/matchesResumeKeyword | R7 #5 | Baixa |

## Decisoes confirmadas pelo usuario (26/mai/2026)

1. **`max_completion_tokens` = 4096** — cobre reasoning de gpt-5 + output
   medio. Aplicar em PR-2.
2. **Hard-cap knowledge full = 50KB** — relaxa para 50KB (acima do
   threshold do auto, que segue 30KB). Aplicar em PR-2.
3. **`create_appointment` action node — completar form** com start_at,
   type_slug, duration_minutes. Form em
   `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx`.
   Aplicar em PR-6.
4. **Cleanup de duplicatas — dry-run primeiro**. Migration 070 cria
   tabela `agent_conversations_merge_log` com o que seria deletado
   (id, organization_id, lead_id, crm_conversation_id, kept_id,
   reason). DELETE manual depois de revisao. Aplicar em PR-1.

## Decisao ainda pendente (pode aguardar pos-barreira)

5. **Cost ceiling default por org nova quando enable native_agent?**
   Hoje cliente cadastra manualmente em `agent_cost_limits`. Vale
   criar default automatico (ex: 10 USD/dia por org)? Nao bloqueia
   nada — pode decidir depois do PR-2 ja com dados reais de consumo.

## Anti-padrao a evitar

Tentar resolver tudo num PR gigante. Os 6 PRs sao atomicos por
design — cada um e revertivel sem desfazer os outros. Combiná-los gera
PR de >1500 LOC, dificil de revisar e perigoso de reverter.

Tambem evitar PR de "refactor + fix" misturados. Os 6 PRs sao apenas
fixes; refactors (history, summarization, Admin/CRM parity) ficam no
backlog em PRs proprios.
