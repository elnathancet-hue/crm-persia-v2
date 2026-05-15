<!--
  PR template — CRM Persia v2

  Não delete seções, marque [x] no que aplica e [ ] no que não.
  Sempre que possível inclua antes/depois (screenshot ou GIF) pra UI.
-->

## Resumo
<!-- 1-3 bullets do que muda. Foco no "porquê", não no "o quê". -->

-

## Test plan
<!-- Bulleted markdown checklist do que testar manualmente. -->

- [ ]
- [ ]

## Visual review (preencher se a PR muda UI)

### Componentes compartilhados
- [ ] Tags renderizadas via `<TagBadge tag={tag} />` — **não** `<Badge>` cru com style inline
- [ ] Stages/outcomes via `<StageBadge stage={stage} />` ou `<StageBadge outcome="...">` — não tabela manual de classes
- [ ] Section labels via `<SectionLabel icon={Icon}>` — não `text-xs uppercase ...` copy-paste
- [ ] Page headers via `<PageTitle>` — não `text-3xl font-bold tracking-tight font-heading`
- [ ] KPI / números grandes via `<KpiValue>` — não `text-3xl font-bold tabular-nums`
- [ ] Dialogs via `<DialogShell size>` (Body/Footer slots) — paddings já fixados em `px-6`

### Tokens semânticos
- [ ] Sem cor cromática hardcoded (`bg-emerald-500`, `text-red-600`, `bg-[#3b82f6]`).
      Use: `bg-success / failure / progress / primary / muted / destructive`
      (ESLint `@persia/no-hardcoded-tailwind-color` deve estar limpo)
- [ ] Light + dark mode testados — toggle no header, toda info segue legível

### Layout / interação
- [ ] Padding mínimo `px-6` em dialogs grandes (lg/xl)
- [ ] Botões críticos não colam nas bordas (Salvar / Excluir / x do header)
- [ ] Touch target ≥ 44px em mobile
- [ ] Form validation inline (sem 500 mudo) — campos com `aria-invalid` + helper text

## Rollout
- [ ] Build CRM verde (`pnpm --filter @persia/crm build`)
- [ ] Build admin verde se mexeu em `packages/*` (`pnpm --filter @persia/admin build`)
- [ ] Tests passam (`pnpm --filter @persia/crm test --run`)
- [ ] Migration aplicada via `npx supabase db push` (se aplicável)
- [ ] Sem segredos commitados (`.env`, tokens)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
