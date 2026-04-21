# Deploy Runbook — CRM Persia Monorepo

Como subir os dois apps (`@persia/crm` e `@persia/admin`) deste monorepo no
EasyPanel, substituindo os deploys antigos dos repos `crm_persia` e
`crm-persia-admin`.

**Estado atual (pre-Fase 2.3):**
- `crm.funilpersia.top` → deploy do repo antigo `crm_persia` (branch main)
- admin `5laby1.easypanel.host` → deploy do repo antigo `crm-persia-admin`

**Objetivo:** trocar os deploys pra este repo (`crm-persia-v2`) sem downtime.
Estrategia: criar 2 servicos novos em paralelo, validar, trocar o dominio.

---

## 0. Pre-requisitos

- [x] Monorepo publicado em https://github.com/elnathancet-hue/crm-persia-v2
- [x] Tags de rollback nos repos antigos: `pre-monorepo-baseline`
- [x] Build local valida: `pnpm -r build` passa nos 2 apps
- [x] Tests locais: `pnpm --filter @persia/crm test` — 69/69
- [ ] EasyPanel acessivel: easypanel.funilpersia.top
- [ ] Janela de manutencao agendada (30min recomendado, rollback <5min)

---

## 1. Arquitetura do deploy

Cada app vira um servico separado no EasyPanel. Ambos apontam pro **mesmo repo**
(`crm-persia-v2`) mas com build/start commands diferentes via `NIXPACKS_*` env vars.

```
EasyPanel VPS (168.231.99.92)
│
├─ service: persia-crm-v2          (novo, Fase 2.3)
│    Source: crm-persia-v2, branch main
│    NIXPACKS_BUILD_CMD = pnpm install --frozen-lockfile && pnpm run build:crm
│    NIXPACKS_START_CMD = pnpm run start:crm
│    Domain: crm.funilpersia.top   (so depois de validar)
│
├─ service: persia-admin-v2        (novo, Fase 2.3)
│    Source: crm-persia-v2, branch main
│    NIXPACKS_BUILD_CMD = pnpm install --frozen-lockfile && pnpm run build:admin
│    NIXPACKS_START_CMD = pnpm run start:admin
│    Domain: crm-admin-persia.funilpersia.top  (novo subdomain, validacao)
│
├─ service: crm_persia             (antigo, mantido durante transicao)
└─ service: crm-persia-admin       (antigo, mantido durante transicao)
```

**Nao deletar os 2 antigos** ate validar 24-48h os novos em prod.
Rollback = voltar o CNAME do dominio pro servico antigo.

---

## 2. Env vars por servico

### 2.1 persia-crm-v2

| Var | Valor | Origem |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tqogqaqwqbdfoevuizxu.supabase.co` | hardcoded em next.config |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (copiar do servico antigo `crm_persia`) | EasyPanel UI |
| `SUPABASE_SERVICE_ROLE_KEY` | (copiar do antigo) | EasyPanel UI |
| `NEXT_PUBLIC_APP_URL` | `https://crm.funilpersia.top` | prod |
| `OPENAI_API_KEY` | (copiar do antigo) | EasyPanel UI |
| `N8N_WEBHOOK_URL` | `https://n8n.funilpersia.top` | prod |
| `META_APP_SECRET` | (copiar do antigo) | EasyPanel UI |
| `CRON_SECRET` | (copiar do antigo) | EasyPanel UI |
| `CRM_API_SECRET` | (copiar do antigo) | EasyPanel UI |
| `NEXT_PUBLIC_PERSIA_WHATSAPP` | (copiar do antigo) | EasyPanel UI |
| `STRIPE_SECRET_KEY` | (copiar do antigo, se aplicavel) | EasyPanel UI |
| `STRIPE_WEBHOOK_SECRET` | (copiar do antigo, se aplicavel) | EasyPanel UI |
| `RESEND_API_KEY` | (copiar do antigo, se aplicavel) | EasyPanel UI |
| `NIXPACKS_BUILD_CMD` | `pnpm install --frozen-lockfile && pnpm run build:crm` | novo |
| `NIXPACKS_START_CMD` | `pnpm run start:crm` | novo |
| `NIXPACKS_NODE_VERSION` | `20` | novo |

### 2.2 persia-admin-v2

| Var | Valor | Origem |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tqogqaqwqbdfoevuizxu.supabase.co` | prod |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (copiar do antigo `crm-persia-admin`) | EasyPanel UI |
| `SUPABASE_SERVICE_ROLE_KEY` | (copiar do antigo) | EasyPanel UI |
| `NEXT_PUBLIC_APP_URL` | `https://crm-admin-persia.funilpersia.top` (staging) → `.5laby1.easypanel.host` (prod) | ajustar em cutover |
| `UAZAPI_SERVER_URL` | `https://chat.funilpersia.top` | prod |
| `UAZAPI_ADMIN_TOKEN` | (copiar do antigo) | EasyPanel UI |
| `OPENAI_API_KEY` | (copiar do antigo) | EasyPanel UI |
| `CRM_CLIENT_BASE_URL` | `https://crm.funilpersia.top` | prod |
| `ADMIN_CONTEXT_SECRET` | (copiar do antigo — NAO regenerar, cookies invalidariam) | EasyPanel UI |
| `NIXPACKS_BUILD_CMD` | `pnpm install --frozen-lockfile && pnpm run build:admin` | novo |
| `NIXPACKS_START_CMD` | `pnpm run start:admin` | novo |
| `NIXPACKS_NODE_VERSION` | `20` | novo |

**Forma rapida de copiar env vars do antigo**: no EasyPanel, servico antigo →
aba Environment → Export → colar no servico novo.

---

## 3. Ordem de execucao

### 3.1 Criar servicos (staging mode — sem dominio oficial)

1. EasyPanel → New Service → App
2. Nome: `persia-admin-v2` (admin primeiro — menor trafego, mais facil validar)
3. Source: GitHub, repo `crm-persia-v2`, branch `main`
4. Colar env vars da secao 2.2
5. Domain: `admin-v2.funilpersia.top` (subdomain temporario pra validacao)
6. Deploy
7. Aguardar build (~5-8min primeiro deploy)
8. Ver logs: pnpm install ok → build ok → start ok

Repetir pro `persia-crm-v2` com dominio temporario `crm-v2.funilpersia.top`.

### 3.2 Validar staging

**Admin-v2 (mais simples, comecar aqui):**
- [ ] Login em `https://admin-v2.funilpersia.top` funciona
- [ ] Dashboard carrega
- [ ] Listar organizacoes funciona (DB access)
- [ ] Ver 1 conversa de cliente (realtime) — ve mensagens atualizando?
- [ ] Templates: listar templates de Meta
- [ ] Sem erros no console

**CRM-v2:**
- [ ] Login em `https://crm-v2.funilpersia.top`
- [ ] Chat: enviar mensagem WhatsApp pra um lead de teste → chega?
- [ ] Incoming: lead manda msg → processIncomingMessage roda (conferir /api/whatsapp/webhook no log)
- [ ] Campaigns: criar/ver campanha
- [ ] Kanban: mover deal
- [ ] Realtime: abrir 2 abas, enviar msg, ver atualizar na outra

Se algo quebrar: investigar logs → ajustar env var OU codigo → re-deploy.
Servicos antigos (prod atual) continuam intocados.

### 3.3 Cutover (troca de dominio)

**Ordem: admin primeiro, CRM depois.** Admin tem menos risco (menos usuarios
simultaneos). Deixar 30min entre os dois pra observar.

#### Admin cutover
1. EasyPanel → servico antigo `crm-persia-admin` → Domains → remover
   `crm-admin-crm-persia-admin.5laby1.easypanel.host`
2. EasyPanel → servico novo `persia-admin-v2` → Domains → adicionar
   `crm-admin-crm-persia-admin.5laby1.easypanel.host`
   (+ remover `admin-v2.funilpersia.top` staging)
3. Esperar ~2min SSL cert refresh
4. Smoke test em prod: login, dashboard, 1 conversa
5. Se quebrar: reverter — voltar dominio pro servico antigo
6. Se ok: segue

#### CRM cutover (30min depois do admin)
1. EasyPanel → servico antigo `crm_persia` → Domains → remover `crm.funilpersia.top`
2. EasyPanel → servico novo `persia-crm-v2` → Domains → adicionar `crm.funilpersia.top`
3. Esperar SSL cert
4. Smoke test em prod:
   - Login
   - Abrir 1 chat com msgs reais
   - Enviar msg pra numero teste → chega no WhatsApp?
   - Responder do WhatsApp → vira mensagem no chat (incoming pipeline)?
   - Realtime atualiza?
5. Se quebrar: reverter dominio pro antigo (rollback <3min)

### 3.4 Cooldown (24h)

Deixar os 2 servicos antigos PARADOS mas NAO deletados por 24h:
1. EasyPanel → servico antigo → Stop (nao Delete)
2. Monitorar logs dos novos
3. Se em 24h nao houve bug, deletar antigos

---

## 4. Rollback

**Rollback rapido (dominio):** reverter passos 3.3.1-3.3.2. Volta prod em ~2min.

**Rollback forte (revert total da Fase 2):**
```bash
# No repo antigo (crm_persia)
cd D:\tmp\crm-persia
git reset --hard pre-monorepo-baseline
git push --force origin main   # NO painel EasyPanel, re-trigger deploy

# No repo antigo (crm-persia-admin)
cd D:\tmp\crm-persia-admin
git reset --hard pre-monorepo-baseline
git push --force origin main   # EasyPanel re-deploy
```

Os dois repos voltam ao estado pre-Fase 2.1. Monorepo em crm-persia-v2 fica
parado mas preservado.

---

## 5. Pos-cutover (arquivamento)

Depois de 24h estavel em prod no monorepo:

1. Archive `crm_persia` no GitHub (Settings → Archive this repository) — read-only
2. Archive `crm-persia-admin` (idem)
3. Deletar servicos antigos do EasyPanel
4. Atualizar memoria/skills:
   - `C:\Users\ELNATHAN\.claude\skills\squad-crm-persia\SKILL.md`
     → atualizar paths de `D:\tmp\crm-persia` pra `D:\tmp\crm-persia-monorepo\apps\crm`
     → remover "Protocolo de Paridade" (shared package ja enforca)
   - `C:\Users\ELNATHAN\.claude\projects\*\memory\MEMORY.md` — nota de cutover

---

## 6. Troubleshooting

### Build falha em "Cannot find module '@persia/shared'"
Nixpacks talvez nao esteja no dir correto. Verificar:
- Repo source e `crm-persia-v2` (nao um subpath)
- NIXPACKS_BUILD_CMD comeca com `pnpm install --frozen-lockfile` (instala do root)
- .npmrc do repo tem `node-linker=hoisted`

### Admin prerender crasha com "useContext of null"
React version mismatch. Confirmar que:
- `apps/admin/package.json` tem `"react": "^19.2.4"` (nao `18.3.1`)
- Root `pnpm-lock.yaml` tem apenas `react@19.x`

### Sharp build script ignorado (warning do pnpm)
`sharp` nao roda scripts de install por default no pnpm. Pra Next Image
otimizar imagens:
```
pnpm approve-builds
# marcar sharp como allowed, commit o package.json
```
Ou ignorar — Next funciona sem sharp (apenas image optimization fica mais lenta).

### Admin .next/standalone sem packages/shared
Checar `apps/admin/next.config.ts` tem `outputFileTracingRoot: path.join(__dirname, "../../")`.
Sem isso, standalone output nao inclui workspace packages.

---

## 7. Validacao pos-cutover (comandos)

Depois de trocar dominios, rodar do seu terminal:

```bash
# CRM healthcheck
curl -I https://crm.funilpersia.top
# 200 OK, header x-powered-by ausente (poweredByHeader:false)

# Admin healthcheck
curl -I https://crm-admin-crm-persia-admin.5laby1.easypanel.host

# Webhook UAZAPI (CRM deve responder 200)
curl -X POST https://crm.funilpersia.top/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{"chatid":"test@s.whatsapp.net","text":"ping"}' \
  -w "\n%{http_code}\n"
```
