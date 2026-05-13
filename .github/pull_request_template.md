<!--
Use este template pra TODO PR de feature/fix.
Definido em 2026-05-13 após auditoria E2E.
Referência: memory/project_architecture_layers.md
-->

## Summary

<!-- 1-3 frases descrevendo o que muda e por que. -->

## Bug / feature ref

<!-- Link pra bug B-X, decisão #N, ou descreva: -->

## Test plan

- [ ] `pnpm --filter <packages-tocados> typecheck` verde
- [ ] `pnpm --filter @persia/crm build` verde (se tocou crm)
- [ ] `pnpm --filter @persia/admin build` verde (se tocou admin)
- [ ] `pnpm --filter @persia/crm test` 100% passa (se tocou actions/lib)
- [ ] Smoke manual pós-merge documentado abaixo

### Smoke manual
<!-- Lista numerada do que validar depois do deploy. Quem dará merge usa essa lista. -->
1.
2.

## Checklist arquitetural

<!-- TODOS os itens abaixo são obrigatórios. Marca N/A se não aplica. -->

### Camadas (memory/project_architecture_layers.md)
- [ ] Imports respeitam top-down (Apps → Feature → DS → Shared)
- [ ] Packages **não** importam de `@/` (app-specific)
- [ ] Packages **não** chamam `createClient()`, `requireRole()`, `useRole()` direto — recebem via DI

### Patterns (packages/ui/docs/patterns.md)
- [ ] Dialog/AlertDialog com mutation usa `useDialogMutation` (ou justifica por que não)
- [ ] Timestamp relativo usa `<RelativeTime iso={...} />` (não `Date.now()` em JSX)
- [ ] Server action retorna `{ data?, error? } | void` (não `throw new Error()`)
- [ ] Mutations em lista usam `useOptimistic` ou refetch explícito

### A11y
- [ ] Inputs têm `name=` (autofill + a11y)
- [ ] Botões só com ícone têm `aria-label`
- [ ] Headers sortable têm `aria-sort`
- [ ] Foco visual em estados de teclado

### i18n PT-BR (memory/feedback_pt_br_accents.md)
- [ ] Strings user-facing com acentos corretos
- [ ] Sem `Automacao`, `Negocio`, `Informacoes`, `Configuracao` etc
- [ ] Mensagens de erro em português amigável

### Hidratação
- [ ] Sem `Date.now()` ou `new Date()` no retorno JSX
- [ ] Sem `localStorage.*` em `useState` initializer (usar `useEffect`)
- [ ] Sem condicional `typeof window` no render

### Feedback de mutação
- [ ] `toast.success(...)` no path de sucesso (com `id` e `duration: 5000`)
- [ ] `toast.error(...)` no path de falha
- [ ] Dialog/Sheet fecha após sucesso

### Segurança / multi-tenant
- [ ] Server action chama `requireRole()` ou `requireSuperadminForOrg()` no início
- [ ] Queries filtram por `organization_id` explícito (defesa em camadas além da RLS)
- [ ] Nenhum `select("*")` sem `.limit()`

### Tests
- [ ] Hook novo no `packages/ui` tem teste unitário
- [ ] Server action nova tem teste de auth + edge cases
- [ ] N/A justificado se não aplica

### Memory (para AI agents)
- [ ] Atualizei `MEMORY.md` se a mudança impacta padrão futuro
- [ ] Criei/atualizei topic file (`memory/project_*.md`) se necessário

---

## Notes

<!-- Trade-offs, dúvidas, links pra discussões prévias. -->

🤖 Generated with [Claude Code](https://claude.com/claude-code)
