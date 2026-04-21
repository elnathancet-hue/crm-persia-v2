# CRM Persia — Monorepo

pnpm workspace contendo os 2 apps do CRM Persia + pacotes compartilhados.

## Estrutura

```
apps/
  crm/      # CRM cliente (crm.funilpersia.top) — was github.com/elnathancet-hue/crm_persia
  admin/    # Admin panel — was github.com/elnathancet-hue/crm-persia-admin
packages/   # compartilhado (types, providers, pipeline) — preenchido na Fase 2.2+
```

## Comandos

```bash
pnpm install                # Instala deps dos dois apps
pnpm dev:crm                # Dev server do CRM
pnpm dev:admin              # Dev server do admin
pnpm build                  # Build de ambos
pnpm lint                   # Lint em ambos
pnpm typecheck              # tsc --noEmit em ambos
pnpm test                   # Testes em ambos (hoje so CRM tem)
```

## Requisitos

- Node >=20
- pnpm 10.33 (fixado via `packageManager`)

## Deploy

Cada app deploya independente no EasyPanel:

- `apps/crm` → crm.funilpersia.top (subpath build com Nixpacks)
- `apps/admin` → crm-admin-crm-persia-admin.5laby1.easypanel.host

Durante a Fase 2 (migracao), os repos originais (`crm_persia`, `crm-persia-admin`)
continuam sendo a fonte dos deploys. Troca so acontece na Fase 2.3.

## Historico

Ver MIGRATION.md pro plano de migracao faseado (2.1 → 2.4).
