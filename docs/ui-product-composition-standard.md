# Padrao de UI: Composicoes de Produto sobre @persia/ui

## Regra Principal

Telas de produto nao devem ser montadas diretamente com primitivos crus quando o fluxo exige layout, hierarquia, estados e acoes. Use `@persia/ui` como fonte de verdade e prefira componentes compostos de produto.

## Ordem de Prioridade

1. Use composicoes de produto do `@persia/ui`:
   - `PageShell`
   - `FeatureDialog`
   - `FeatureSheet`
   - `Toolbar`
   - `MetricsStrip`
   - `EntityList`
   - `EntityRow`
   - `BulkActionBar`
   - `DialogShell`
   - `MetricCard`
   - `EmptyState`
2. Use primitivos do `@persia/ui` para detalhes internos:
   - `Button`
   - `Input`
   - `Badge`
   - `Dialog`
   - `Sheet`
   - `Tabs`
   - `Select`
3. Nao importe `@base-ui/react` em tela de produto.
4. Altere primitivos globais apenas quando o problema for sistemico e validado em varias telas.

## Quando Criar uma Composicao

Crie ou use uma composicao quando a UI tiver pelo menos dois destes itens:

- header com titulo/descricao/acoes;
- busca ou filtros;
- lista de entidades;
- metricas/resumo;
- selecao em massa;
- estados loading/empty/error;
- footer fixo;
- scroll interno;
- acoes por item.

## Anti-Padroes

- Entregar uma feature como `Dialog + Input + Button + divs` sem estrutura.
- Ajustar padding/largura global de `DialogContent` para resolver uma tela especifica.
- Criar lista densa com linhas sem altura minima, sem truncamento e sem estado vazio.
- Usar botao de texto quando um icone padrao com tooltip resolver melhor.
- Esconder a acao principal no menu de tres pontos.

## Exemplo de Composicao Esperada

```tsx
<FeatureDialog
  open={open}
  onOpenChange={setOpen}
  size="xl"
  title="Participantes"
  description="Grupo Comunicacao CSCJ 2025"
  summary={<MetricsStrip items={metrics} />}
  actions={<Button variant="outline">Sincronizar</Button>}
  footer={<Button onClick={() => setOpen(false)}>Fechar</Button>}
>
  <Toolbar search={<Input placeholder="Buscar participante..." />} filters={filters} />
  <BulkActionBar selectedCount={selected.length}>...</BulkActionBar>
  <EntityList>
    <EntityRow
      avatar={<Avatar />}
      title="Elnathan"
      subtitle="+55..."
      badges={<Badge variant="secondary">Lead</Badge>}
      actions={<Button size="sm">Abrir chat</Button>}
    />
  </EntityList>
</FeatureDialog>
```

## Resultado Esperado

O padrao reduz telas apertadas, melhora hierarquia visual e evita que cada feature redesenhe estrutura basica. Primitivos continuam existindo, mas como base; o produto deve ser entregue com composicoes.

