# Admin Panel - Roadmap

## Status Atual
- [x] Login superadmin funcionando
- [x] Dashboard com stats (clientes, leads, conversas)
- [x] Lista de clientes
- [x] Criar cliente (formulário completo com serviços)
- [x] Editar cliente + services toggles
- [x] Conectar instância UAZAPI por cliente
- [x] Ver membros do cliente
- [x] Deploy no EasyPanel via Nixpacks

## Fase CRM Completo no Admin - IMPLEMENTADO
- [x] Seletor de cliente no header (Zustand + localStorage)
- [x] Sidebar expandida (Chat, Leads, CRM, Grupos)
- [x] 17 componentes UI (shadcn/base-ui) copiados do CRM
- [x] WhatsApp provider (UAZAPI adapter completo)

### Chat (/chat)
- [x] Lista de conversas com busca e filtros (Todas, IA, Aguardando)
- [x] Janela de chat com mensagens em tempo real (Supabase Realtime)
- [x] Envio de mensagens de texto via WhatsApp (UAZAPI)
- [x] Transferir para IA / Fechar conversa
- [x] Badge de não lidas
- [x] Polling fallback (10s)

### Leads (/leads)
- [x] Lista paginada com busca e filtro por status
- [x] Criar lead (modal)
- [x] Detalhe do lead (editar nome, telefone, email, status)
- [x] Tags (adicionar/remover)
- [x] Histórico de atividades
- [x] Excluir lead

### CRM Kanban (/crm)
- [x] Pipelines com stages e deals
- [x] Drag-and-drop nativo (HTML5) entre stages
- [x] Criar pipeline (5 stages padrão)
- [x] Criar/excluir deals
- [x] Total de valor em tempo real

### Grupos WhatsApp (/groups)
- [x] Lista de grupos com contagem de participantes
- [x] Sincronizar grupos via UAZAPI
- [x] Link de convite

## Próxima Fase
- [ ] Envio de mídia no chat (imagem, áudio, documento)
- [ ] Automações (flows/assistentes IA) - visualização
- [ ] Relatórios
- [ ] Configurações do cliente (equipe, filas, webhooks)
- [ ] Campanhas
- [ ] Deploy atualizado no EasyPanel

## Credenciais
- Login: suporte@amaliasaraiva.com / CRM123456
- Supabase URL: https://tqogqaqwqbdfoevuizxu.supabase.co
- EasyPanel: easypanel.funilpersia.top
- Repo: github.com/elnathancet-hue/crm-persia-admin
