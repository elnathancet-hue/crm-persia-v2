# Roteiro de Implementacao: Segmentacao Comercial Simples e Confiavel

## Objetivo

Evoluir a funcionalidade de **Segmentacao** do CRM para deixar de parecer um construtor tecnico de query e virar uma central de publicos comerciais acionaveis.

Hoje a base tecnica e boa: segmentos sao dinamicos por regras, filtram Leads, aparecem na aba CRM e podem disparar fluxos quando um lead entra. O problema principal esta em UX, previsibilidade e linguagem de negocio.

Este roteiro deve ser executado por etapas pequenas, com validacao em cada PR. Nao implementar tudo de uma vez.

## Principios Anti-Bug

- Nao quebrar segmentos existentes salvos em `segments.rules`.
- Nao mudar o formato JSONB das regras sem migracao/backward compatibility.
- Toda query deve filtrar `organization_id`.
- O backend continua sendo fonte da verdade para contagem e matching.
- Regras incompletas nao devem salvar silenciosamente.
- UI deve impedir valores impossiveis sempre que houver catalogo conhecido.
- Tag deve ser selecionada por ID, mas exibida por nome/cor.
- Responsavel deve ser selecionado por ID, mas exibido por nome.
- Segmentos vazios, invalidos ou sem regras devem ter comportamento explicito.
- Toda mudanca em matcher deve ter teste.
- Toda acao em massa deve mostrar contagem, confirmacao e resultado.
- UI nova deve seguir `docs/ui-product-composition-standard.md`.
- Nao importar primitivos de baixo nivel diretamente em tela de produto quando houver composicao em `@persia/ui`.

## Estado Atual Resumido

### O que ja existe

- Lista de segmentacoes em `CRM > Segmentacao`.
- Criacao, edicao e exclusao por admin.
- Regras salvas em JSONB:
  - `operator`: `AND` ou `OR`;
  - `conditions`: array de `{ field, op, value }`.
- Filtro de Leads por `segmentId`.
- Botao `Ver leads`.
- Evaluator que persiste entrada em `segment_memberships`.
- Gatilho de automacao/fluxo quando lead entra em segmento.

### Campos suportados pelo matcher

- `status`
- `source`
- `channel`
- `score`
- `tags`
- `assigned_to`
- `created_at`
- `last_interaction_at`

### Problemas atuais

- UI exige raciocinio tecnico: campo + operador + valor.
- Nao ha preview de quantos leads serao afetados.
- Tags usam input livre, mas backend espera `tag_id`.
- Status/origem/canal usam texto livre.
- Cards nao explicam as regras em linguagem humana.
- Nao ha templates prontos de segmentos.
- Nao ha busca/filtro de segmentos.
- `lead_count` pode ficar defasado.
- Segmento vazio/malformado pode ser tratado como filtro ignorado em alguns caminhos.
- Membership atual trata entrada, mas nao trata saida do segmento.
- Nao ha segmentacao por etapa do funil/pipeline.
- Segmentos ainda nao sao suficientemente acionaveis.

## Arquivos e Servicos Envolvidos

### UI

- `packages/segments-ui/src/components/SegmentsList.tsx`
- `packages/segments-ui/src/components/ConditionBuilder.tsx`
- `apps/crm/src/components/segments/segment-list.tsx`
- `apps/crm/src/app/(dashboard)/crm/crm-shell.tsx`

### Actions

- `apps/crm/src/actions/segments.ts`
- `apps/crm/src/features/segments/crm-segments-actions.ts`
- `apps/crm/src/actions/leads.ts`
- `apps/crm/src/actions/tags.ts`

### Matcher e queries

- `packages/shared/src/crm/segments/match-leads.ts`
- `packages/shared/src/crm/queries/leads.ts`
- `packages/shared/src/crm/types.ts`

### Automacoes

- `apps/crm/src/lib/segments/evaluator.ts`
- `apps/crm/src/lib/segments/lead-hook.ts`
- `apps/crm/src/lib/ai-agent/flow/triggers.ts`

### Banco

- `segments`
- `segment_memberships`
- `leads`
- `lead_tags`
- `tags`
- `deals`
- `pipeline_stages`

## Etapa 0: Baseline e Testes de Caracterizacao

### Objetivo

Garantir que qualquer melhoria de UX nao quebre segmentos existentes nem o filtro de Leads.

### Tarefas

1. Listar exemplos reais de `segments.rules` existentes no banco/dev.
2. Criar fixtures para regras simples e combinadas.
3. Testar `findMatchingLeadIds` com:
   - regra vazia;
   - regra invalida;
   - `AND`;
   - `OR`;
   - tag contem;
   - tag nao contem;
   - responsavel;
   - sem responsavel;
   - data maior/menor que X dias;
   - score.
4. Testar filtro de Leads por `segmentId`.
5. Documentar comportamento atual de segmento sem regra.

### Validacao

```bash
git status --short
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/shared typecheck
pnpm --filter @persia/crm test
```

### Criterio de Aceite

- Nenhuma mudanca funcional.
- Testes cobrindo o comportamento atual.
- Risco de regressao mapeado antes da mudanca visual.

## Etapa 1: Catalogos Reais para o Builder

### Objetivo

Remover inputs livres onde o sistema ja conhece os valores possiveis.

### Entrega

Passar para `SegmentsList`/`ConditionBuilder` catalogos de:

- tags;
- responsaveis;
- status;
- canais;
- origens conhecidas;
- pipelines;
- etapas do funil, quando a etapa futura for suportada.

### UX Esperada

Em vez de digitar manualmente:

- `Tags contem [input livre]`

O usuario deve selecionar:

- `Tags contem [Interessado]`

Com badge/color visual da tag.

### Contrato Sugerido

```ts
type SegmentCatalogs = {
  tags: Array<{ id: string; name: string; color: string | null }>;
  assignees: Array<{ id: string; name: string }>;
  statuses: Array<{ value: string; label: string }>;
  channels: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
  pipelines?: Array<{ id: string; name: string }>;
  stages?: Array<{ id: string; pipeline_id: string; name: string; color: string | null }>;
};
```

### Cuidados Anti-Bug

- Valores antigos salvos como string continuam abrindo.
- Se tag salva nao existir mais, mostrar `Tag removida` com estado de erro.
- Se responsavel foi removido, mostrar `Responsavel removido`.
- Nao converter label em value; salvar sempre ID quando o campo exigir ID.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm exec eslint "src/components/segments/segment-list.tsx"
pnpm --filter @persia/crm exec eslint packages/segments-ui/src/components/ConditionBuilder.tsx
```

### Criterio de Aceite

- Tags e responsaveis sao selecionados por dropdown.
- Regras antigas continuam editaveis.
- Usuario nao precisa conhecer UUID de tag.

## Etapa 2: Builder em Linguagem de Negocio

### Objetivo

Transformar a experiencia de `campo + operador + valor` em frases compreensiveis.

### Entrega

Redesenhar cada linha de regra para parecer uma frase:

- `Incluir leads onde [Tag] [contem] [Interessado]`
- `E [Ultima interacao] [ha mais de] [30] dias`
- `E [Responsavel] [esta vazio]`

### Mudancas de UX

- Trocar labels tecnicas por linguagem comercial.
- Mostrar ajuda contextual por campo.
- Para operadores sem valor (`is_null`), esconder input de valor.
- Para datas relativas, usar input numerico com sufixo `dias`.
- Para score, usar input numerico com validacao.
- Para status/canal/origem, usar select.

### Cuidados Anti-Bug

- `ConditionBuilder` deve continuar emitindo o mesmo shape:
  - `{ field, op, value }`.
- Nao trocar `AND/OR` internamente.
- Ao mudar campo, resetar operador e valor para defaults validos.
- Nao permitir salvar regra incompleta.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm exec eslint packages/segments-ui/src/components/ConditionBuilder.tsx
```

### Criterio de Aceite

- Usuario entende a regra lendo a tela.
- Regra incompleta fica visualmente marcada.
- Regra salva continua compativel com backend atual.

## Etapa 3: Validacao Forte de Regras

### Objetivo

Impedir que segmentos invalidos sejam salvos silenciosamente.

### Entrega

Criar um validador compartilhado para `SegmentRules`.

Validar:

- `conditions` existe e e array;
- pelo menos uma regra para segmento ativo;
- `field` permitido;
- `op` permitido para o field;
- `value` obrigatorio quando operador exige valor;
- numero valido para score/dias;
- UUID ou ID conhecido para tag/responsavel;
- operadores sem valor devem salvar `value: ""`.

### Local Recomendado

- `packages/shared/src/crm/segments/validate-rules.ts`

### Cuidados Anti-Bug

- Validador deve ser usado no client e server.
- Server action nunca deve confiar apenas no client.
- Segmentos antigos invalidos devem poder abrir em modo `precisa revisar`, nao quebrar a tela.

### Validacao

```bash
pnpm --filter @persia/shared typecheck
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test -- segments
```

### Criterio de Aceite

- Nao salva regra invalida nova.
- Segmento antigo invalido mostra erro claro.
- Matcher nao recebe regra impossivel sem log/controle.

## Etapa 4: Preview de Quantidade Antes de Salvar

### Objetivo

Dar previsibilidade: o usuario deve saber quantos leads entram antes de criar ou editar.

### Entrega

Criar action:

```ts
previewSegmentRules(rules: SegmentRules): Promise<{
  count: number;
  sample: Array<{ id: string; name: string | null; phone: string | null; status: string; source: string }>;
  warnings: string[];
}>
```

### UX Esperada

No dialog:

- contador: `128 leads encontrados`;
- lista curta dos primeiros leads;
- aviso se regra esta incompleta;
- aviso se regra usa tag removida;
- botao `Ver amostra`;
- debounce ao alterar regra.

### Cuidados Anti-Bug

- Debounce para nao consultar a cada tecla.
- Cancelar resposta antiga se usuario alterou a regra.
- Limitar sample a 5 ou 10 leads.
- Action deve filtrar `organization_id`.
- Preview nao deve salvar nada.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test -- segments
pnpm --filter @persia/crm exec eslint src/actions/segments.ts
```

### Criterio de Aceite

- Usuario ve contagem antes de salvar.
- Preview nao altera banco.
- Preview e consistente com `Ver leads` depois de salvar.

## Etapa 5: Cards com Resumo Legivel

### Objetivo

Fazer a lista de segmentos ser auditavel sem abrir cada item.

### Entrega

Adicionar em cada card:

- resumo das regras em linguagem humana;
- badges dos principais criterios;
- status de saude:
  - `OK`;
  - `Precisa revisar`;
  - `Sem regras`;
  - `0 leads`;
- ultima atualizacao, se disponivel;
- CTA principal `Ver leads`.

### Exemplos de Resumo

- `Tag contem Interessado E ultima interacao ha mais de 30 dias`
- `Responsavel esta vazio OU status e Novo`
- `Origem e Instagram E score maior que 70`

### Cuidados Anti-Bug

- Resumo deve tolerar regra antiga ou campo desconhecido.
- Se label nao for encontrado, mostrar fallback tecnico em tom discreto.
- Nao recalcular matching pesado na renderizacao do card.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm exec eslint packages/segments-ui/src/components/SegmentsList.tsx
```

### Criterio de Aceite

- Usuario entende o segmento sem abrir modal.
- Segmento problematico fica evidente.
- Lista continua responsiva.

## Etapa 6: Templates Comerciais de Segmentacao

### Objetivo

Fazer o usuario criar bons segmentos em poucos cliques.

### Entrega

Adicionar fluxo `Nova segmentacao` com duas opcoes:

1. `Comecar de um modelo`
2. `Criar do zero`

### Templates Recomendados

- `Leads sem responsavel`
- `Leads novos da semana`
- `Leads sem interacao ha 30 dias`
- `Leads quentes`
- `Leads com tag especifica`
- `Leads por origem`
- `Leads perdidos`
- `Leads importados recentemente`
- `Leads de grupos WhatsApp`
- `Clientes que precisam de follow-up`

### Cada Template Deve Ter

- nome sugerido;
- descricao;
- regras iniciais;
- campos editaveis destacados;
- CTA `Usar modelo`;
- preview apos preencher campos obrigatorios.

### Cuidados Anti-Bug

- Template gera o mesmo `SegmentRules` padrao.
- Campos obrigatorios do template devem ser preenchidos antes de salvar.
- Nao criar segmento duplicado automaticamente.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm exec eslint packages/segments-ui/src/components/SegmentsList.tsx
```

### Criterio de Aceite

- Usuario consegue criar segmento util sem entender operador tecnico.
- Templates geram regras validas.
- Preview funciona com templates.

## Etapa 7: Busca, Filtros e Organizacao da Lista

### Objetivo

Preparar a tela para muitas segmentacoes.

### Entrega

Adicionar no topo da aba:

- busca por nome/descricao/regra;
- filtros:
  - todos;
  - com leads;
  - sem leads;
  - precisa revisar;
  - usados em automacao;
- ordenacao:
  - mais recentes;
  - mais leads;
  - nome;
  - atualizados recentemente.

### UX Recomendada

Usar `Toolbar`/composicoes do `@persia/ui`, conforme padrao de produto.

### Cuidados Anti-Bug

- Busca client-side pode ser suficiente inicialmente.
- Se a lista crescer muito, migrar para query server-side paginada.
- Filtros nao devem esconder segmento problemático sem deixar limpar filtro.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm exec eslint packages/segments-ui/src/components/SegmentsList.tsx
```

### Criterio de Aceite

- Usuario encontra segmento rapidamente.
- Estado vazio do filtro e claro.
- Layout nao fica apertado.

## Etapa 8: Segmentos Acionaveis

### Objetivo

Transformar segmento em publico para acao comercial.

### Entrega

Adicionar acoes por segmento:

- `Ver leads`;
- `Exportar`;
- `Enviar campanha`;
- `Iniciar fluxo`;
- `Adicionar tag em massa`;
- `Atribuir responsavel`;
- `Criar tarefa para o time`;
- `Duplicar segmento`;
- `Arquivar`.

### Escopo Inicial Seguro

Primeiro PR desta etapa deve entregar apenas:

- `Duplicar segmento`;
- `Exportar`;
- `Adicionar tag em massa` com confirmacao.

### Cuidados Anti-Bug

- Toda acao em massa deve recalcular os leads no server no momento da execucao.
- Mostrar contagem antes de confirmar.
- Nao executar acao em segmento invalido.
- Se parte falhar, exibir resumo de sucesso/falha.
- Registrar atividade/auditoria quando mexer em muitos leads.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test
```

### Criterio de Aceite

- Segmento deixa de ser apenas filtro.
- Acoes em massa sao previsiveis e confirmadas.
- Nenhum lead fora do segmento e alterado.

## Etapa 9: Suporte a Etapa do Funil e Pipeline

### Objetivo

Adicionar uma das segmentacoes mais importantes para CRM: etapa do funil.

### Entrega

Suportar regras:

- `pipeline_id eq`
- `stage_id eq`
- `stage_outcome eq`
- `deal_status eq`
- `sem negocio aberto`
- `negocio aberto ha mais de X dias sem mudanca`

### Matcher

Adicionar resolvers em `findMatchingLeadIds` para joins com:

- `deals`;
- `pipeline_stages`;
- possivelmente `leads.stage_id` se o modelo lead-centric ja tiver coluna.

### UX

No builder:

- Campo: `Etapa do funil`
- Select de pipeline, depois select de etapa.
- Mostrar cor da etapa.

### Cuidados Anti-Bug

- Validar que etapa pertence ao pipeline e a organizacao.
- Se pipeline for removido, regra fica em estado `precisa revisar`.
- Nao contar deal fechado como etapa atual, salvo regra especifica.
- Definir claramente se segmento olha para lead-centric stage ou deals.

### Validacao

```bash
pnpm --filter @persia/shared typecheck
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test -- segments
```

### Criterio de Aceite

- Segmento por etapa bate com Kanban.
- Mudanca de etapa atualiza membership/automacao quando aplicavel.
- Regra por funil nao cruza dados de outra org.

## Etapa 10: Membership Confiavel: Entrada e Saida

### Objetivo

Tornar `segment_memberships` uma representacao confiavel do estado atual, nao apenas log de entrada.

### Entrega

Evoluir membership para suportar:

- entrada;
- saida;
- reentrada;
- historico.

### Modelo Possivel

Adicionar colunas:

- `entered_at`
- `left_at`
- `last_evaluated_at`
- `is_active`

Ou manter uma tabela historica separada:

- `segment_membership_events`

### Cuidados Anti-Bug

- Nao disparar fluxo de `segment_entered` repetidamente se lead ja esta ativo.
- Se lead sai e entra de novo, decidir regra de produto:
  - dispara de novo;
  - dispara apenas uma vez;
  - dispara apos cooldown.
- Atualizacao deve ser idempotente.
- Falha de evaluator nao pode quebrar update de lead.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test -- segment
```

### Criterio de Aceite

- Lead que deixa de bater na regra fica inativo no segmento.
- Entrada dispara automacao uma vez.
- Reentrada segue politica definida.

## Etapa 11: Contagem Confiavel de Leads

### Objetivo

Garantir que `lead_count` mostrado na lista represente a verdade ou deixe claro que e estimativa/cache.

### Opcoes

1. Calcular sob demanda com `findMatchingLeadIds`.
2. Atualizar cache em `segments.lead_count` apos mudancas relevantes.
3. Usar `segment_memberships` ativo como fonte de contagem.

### Recomendacao

Curto prazo:

- preview e cards podem calcular sob demanda com debounce/cache leve.

Medio prazo:

- usar `segment_memberships.is_active = true` para contagem rapida.

### Cuidados Anti-Bug

- Nao mostrar numero defasado sem indicacao.
- Se contagem falhar, mostrar `Nao foi possivel calcular`.
- Nao recalcular todos os segmentos a cada render.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test -- segments
```

### Criterio de Aceite

- Numero no card bate com `Ver leads`.
- Contagem nao degrada performance perceptivelmente.

## Etapa 12: Observabilidade e Auditoria

### Objetivo

Facilitar suporte e diagnostico.

### Entrega

Logar eventos:

- segmento criado;
- segmento editado;
- segmento excluido;
- preview falhou;
- regra invalida detectada;
- membership entrou;
- membership saiu;
- automacao disparada por segmento;
- acao em massa executada.

### Dados Recomendados

- `organization_id`;
- `user_id`, quando houver;
- `segment_id`;
- `lead_count`;
- `event_type`;
- `error_message`;
- timestamp.

### Cuidados Anti-Bug

- Nao salvar dados pessoais completos em log.
- Falha de log nao deve quebrar fluxo principal.
- Logs de evaluator devem ser rate-limited se necessario.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test
```

### Criterio de Aceite

- Suporte consegue entender por que um lead entrou ou nao entrou num segmento.
- Falhas aparecem com contexto suficiente.

## Plano de PRs Recomendado

1. **PR A: Baseline e testes**
   - testes do matcher;
   - fixtures de regras;
   - nenhum comportamento novo.

2. **PR B: Catalogos no builder**
   - tags, status, origem, canal, responsavel;
   - preservar regras antigas.

3. **PR C: Builder em linguagem humana**
   - linhas de regra como frases;
   - validacao visual local.

4. **PR D: Validador compartilhado**
   - client + server;
   - impedir salvar regra invalida nova.

5. **PR E: Preview de quantidade**
   - action server-side;
   - debounce;
   - sample de leads.

6. **PR F: Cards legiveis**
   - resumo humano;
   - status de saude;
   - melhor organizacao visual.

7. **PR G: Templates comerciais**
   - modelos prontos;
   - fluxo criar do modelo.

8. **PR H: Busca e organizacao**
   - toolbar;
   - filtros;
   - ordenacao.

9. **PR I: Acoes por segmento**
   - duplicar;
   - exportar;
   - adicionar tag em massa.

10. **PR J: Etapa do funil**
    - matcher;
    - builder;
    - testes.

11. **PR K: Membership ativa**
    - entrada/saida;
    - contagem confiavel;
    - automacao sem duplicidade.

12. **PR L: Observabilidade**
    - eventos;
    - auditoria;
    - suporte operacional.

## Checklist Geral Antes de Merge

- `git status --short` revisado.
- `pnpm --filter @persia/crm typecheck` passando.
- `pnpm --filter @persia/shared typecheck` passando se tocar matcher/tipos.
- ESLint dos arquivos alterados passando.
- Testes relevantes passando.
- Segmentos antigos abrem sem quebrar.
- Segmento com tag existente funciona.
- Segmento com tag removida mostra aviso.
- Segmento com responsavel removido mostra aviso.
- Segmento com `AND` bate corretamente.
- Segmento com `OR` bate corretamente.
- Segmento sem regra tem comportamento explicito.
- Preview bate com `Ver leads`.
- Card mostra resumo humano.
- Mobile nao fica apertado.
- Usuario sem permissao nao cria/edita/exclui.
- Server action bloqueia usuario sem permissao.
- Toda query nova filtra `organization_id`.

## Resultado Esperado

Ao final, Segmentacao deve virar uma area comercial clara:

- usuario cria publico sem entender query;
- regras sao guiadas por selects reais;
- preview mostra impacto antes de salvar;
- cards explicam quem esta dentro;
- segmentos podem disparar acoes;
- funil/pipeline entram como criterio nativo;
- memberships ficam confiaveis;
- automacoes por entrada em segmento ficam seguras;
- suporte consegue auditar o comportamento.

