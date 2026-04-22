# Infraestrutura VPS — CRM Persia

> Documentacao para agentes de IA sobre a VPS que suporta o CRM Persia.
> O CRM roda no EasyPanel (crm.funilpersia.top), na mesma VPS que o admin, n8n e UAZAPI.
> Ultima atualizacao: 2026-04-18

---

## 1. VPS Hostinger KVM 2

- **IP:** 168.231.99.92
- **SO:** Ubuntu 24.04 LTS
- **RAM:** 8GB | **CPU:** 2 vCPU | **Disco:** 100GB NVMe
- **Dominio:** funilpersia.top
- **DNS Wildcard:** `*.funilpersia.top` → 168.231.99.92
- **Gerenciamento:** Easypanel v2.23.0 (easypanel.funilpersia.top)
- **Reverse Proxy/SSL:** Traefik (automatico via Easypanel)
- **Acesso SSH:** Terminal do navegador no hPanel da Hostinger

---

## 2. Containers no Easypanel

### Projeto: n8n
| Container | Tipo | Funcao |
|-----------|------|--------|
| n8n | app | Instancia admin (interna) — n8n.funilpersia.top |
| n8n_teste | app | Tenant de teste — teste.funilpersia.top |
| postgres | postgres | Banco compartilhado (1 DB por tenant) |
| redis | redis | Cache/filas |

**PostgreSQL:**
- User: `elnathan`
- Database padrao: `n8n`
- Tenants: `n8n_<nome_do_cliente>`

### Projeto: evolution
| Container | Tipo | Funcao |
|-----------|------|--------|
| evolution-api | app | WhatsApp Business API (UAZAPI) |
| evolution-api-db | postgres | Banco da Evolution |
| evolution-api-redis | redis | Cache da Evolution |

---

## 3. Multi-Tenant n8n

Cada cliente tem um container n8n isolado com:
- Database PostgreSQL separado (`n8n_<cliente>`)
- Encryption key unica
- Subdominio proprio (`<cliente>.funilpersia.top`)

### Scripts na VPS (`/opt/n8n-tenants/`)

```bash
bash add-tenant.sh <nome>     # Cria DB + credenciais + instrucoes para Easypanel
bash remove-tenant.sh <nome>  # Backup + remove DB + credenciais
bash list-tenants.sh           # Lista tenants + uso de recursos
bash backup.sh                 # Backup de todos os DBs (cron diario 3h)
```

### Provisionar novo cliente
1. SSH na VPS → `bash /opt/n8n-tenants/add-tenant.sh <nome>`
2. No Easypanel → projeto "n8n" → + App → Docker Image `n8nio/n8n:latest`
3. Colar variaveis de ambiente do output do script
4. Adicionar dominio: `<nome>.funilpersia.top` → porta `5678`
5. Deploy

### Variaveis de ambiente por tenant
```env
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=n8n_postgres
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=n8n_<CLIENTE>
DB_POSTGRESDB_USER=elnathan
DB_POSTGRESDB_PASSWORD=<senha_do_postgres>
N8N_ENCRYPTION_KEY=<chave_unica_gerada>
WEBHOOK_URL=https://<CLIENTE>.funilpersia.top/
N8N_HOST=0.0.0.0
N8N_PORT=5678
N8N_PROTOCOL=https
EXECUTIONS_MODE=regular
GENERIC_TIMEZONE=America/Sao_Paulo
N8N_DEFAULT_LOCALE=pt
```

### Backups
- Local: `/opt/n8n-backups/`
- Formato: `n8n_<cliente>_<data>.sql.gz`
- Retencao: 7 dias
- Cron: `0 3 * * *`

---

## 4. Comunicacao n8n ↔ CRM

O n8n se comunica com o CRM via estas APIs:

### CRM → n8n (IA)
Quando uma mensagem chega no CRM e a IA esta ativa, o CRM faz POST para o n8n:

```
POST https://n8n.funilpersia.top/webhook/<webhook_id>

Body:
{
  "telefone": "5511999999999",
  "query": "mensagem do lead",
  "leadId": "uuid",
  "orgId": "uuid"
}

Resposta do n8n:
{
  "output": "resposta da IA"
}
```

O CRM entao salva a resposta no Supabase e envia via UAZAPI.

### n8n → CRM (acoes)
O n8n pode executar acoes no CRM via estas APIs:

**GET /api/tools** — Lista ferramentas disponiveis
- Query params: `orgId`, `slug`, `category`, `id`

**POST /api/crm** — Executa acoes:
- `move_deal` — mover deal no pipeline
- `add_tag` — adicionar tag ao lead
- `remove_tag` — remover tag
- `pause_bot` — pausar bot na conversa
- `get_lead` — buscar dados do lead
- `update_lead` — atualizar lead

---

## 5. Fluxo de Mensagens WhatsApp

```
Lead manda mensagem
       ↓
UAZAPI recebe
       ↓
Webhook POST → CRM (EasyPanel/crm.funilpersia.top) /api/whatsapp/webhook
       ↓
CRM salva no Supabase + verifica se IA esta ativa
       ↓
Se IA ativa → POST para n8n (VPS)
       ↓
n8n processa (GPT + tools) → retorna resposta
       ↓
CRM salva resposta no Supabase + envia via UAZAPI
       ↓
Browser recebe via Supabase Realtime (WebSocket)
```

### Otimizacao futura
Mover o webhook do WhatsApp para o n8n (VPS), eliminando round-trips externos:
- Mudar URL no UAZAPI para `n8n.funilpersia.top/webhook/whatsapp`
- n8n salva direto no Supabase
- Resultado: comunicacao interna na VPS (~5ms)

---

## 6. Limites de Recursos

| Clientes n8n | RAM estimada | Status |
|-------------|-------------|--------|
| 0 (base) | ~2.9GB | OK |
| 2 | ~3.7GB | OK |
| 5 | ~4.9GB | OK |
| 7-8 | ~6.1-6.5GB | Apertado |
| 10+ | ~7GB+ | Upgrade KVM 4 |

### Plano de escalabilidade
| Plano | RAM | Clientes | Custo |
|-------|-----|----------|-------|
| KVM 2 | 8GB | Ate 7-8 | ~$7/mes |
| KVM 4 | 16GB | Ate 20 | ~$12/mes |
| KVM 8 | 32GB | Ate 30 | ~$24/mes |

---

## 7. Deploy do CRM no EasyPanel

O CRM ja roda no EasyPanel em `crm.funilpersia.top`.

- **Fonte:** GitHub (repo crm_persia, branch main)
- **Build:** Nixpacks (detecta Next.js automaticamente)
- **Start:** `npm start` | Porta: `3000`
- **Deploy:** push em `main` → EasyPanel faz auto-deploy

Vantagens: webhooks internos (~5ms), sem limite de requisicoes, toda stack na mesma VPS.
Desvantagens: -400MB RAM, sem CDN, se VPS cair tudo cai.

---

## 8. Monitoramento

### Via SSH
```bash
free -h                                    # RAM
df -h                                      # Disco
docker stats --no-stream                   # RAM por container
docker logs n8n_n8n-<cliente> --tail 50    # Logs de um tenant
bash /opt/n8n-tenants/list-tenants.sh      # Listar tenants
```

### Alertas
| Metrica | Atencao | Acao |
|---------|---------|------|
| RAM > 70% | Monitorar | Verificar containers |
| RAM > 85% | Urgente | Upgrade KVM 4 |
| Disco > 80% | Monitorar | Limpar backups/logs |
| Disco > 90% | Urgente | Expandir |

---

## 9. Subdominios DNS

| Subdominio | Servico |
|-----------|---------|
| `*.funilpersia.top` | Wildcard (todos os tenants) |
| `easypanel.funilpersia.top` | Painel Easypanel |
| `n8n.funilpersia.top` | n8n admin |
| `persia.uazapi.com` | UAZAPI Cloud (WhatsApp provider) |
| `<cliente>.funilpersia.top` | n8n do cliente |

---

## 10. GitHub

- **Repo:** github.com/elnathancet-hue/crm_persia (privado)
- **Branch main:** producao (protegida)
- **Branch develop:** desenvolvimento
- **Fluxo:** feature → develop → PR → main

---

## 11. Supabase Migrations (workflow)

Ref do projeto Supabase: `tqogqaqwqbdfoevuizxu` · URL: `tqogqaqwqbdfoevuizxu.supabase.co`
CRM client ja esta linkado (via `supabase/.temp/project-ref`).

### Principio
Este repo (`crm_persia`) e a **fonte unica** de migrations. Arquivos vivem em
`supabase/migrations/NNN_description.sql` numerados sequencialmente. Admin
(`crm-persia-admin`) NAO aplica migrations via Dashboard — autor abre o SQL
aqui e usa `supabase db push`.

### Comandos basicos

```bash
# Ver estado local vs remoto
npx supabase migration list --linked

# Criar nova migration
npx supabase migration new <nome_descritivo>
# (CLI cria <timestamp>_<nome>.sql — renomeie pro padrao NNN_description.sql)

# Aplicar migrations pendentes ao remoto
npx supabase db push

# Marcar uma migration como aplicada (se foi rodada fora do CLI, ex: Dashboard)
npx supabase migration repair --status applied <version>
```

### Padrao de arquivo de migration
- **Pre-flight check** antes de `ALTER/CREATE` nao-idempotente. Referencia:
  `009_messages_status_check.sql` e `010_leads_unique_phone.sql` usam
  `DO $$ ... RAISE EXCEPTION` pra abortar se dado legado quebraria o constraint.
- **Comentario de rollback** em SQL comentado no final do arquivo.
- **Motivo no cabecalho** (o porque, nao o o que).

### Fluxo em PRs
1. PR adiciona `supabase/migrations/NNN_description.sql`
2. Revisor roda `npx supabase migration list --linked` — deve aparecer como local-only
3. Revisa o SQL (pre-flight, idempotencia, rollback)
4. Apos merge em main, quem fez merge roda `npx supabase db push` localmente
   (CI nao tem credenciais de DB — 1.5 estabelece o workflow local)

### Baseline (2026-04-20)
001-010 alinhados local ↔ remoto. Migrations aplicadas historicamente via
Dashboard foram adotadas via `supabase migration repair --status applied`
nesta sessao. `supabase_migrations.schema_migrations` agora reflete o estado
real do schema.
