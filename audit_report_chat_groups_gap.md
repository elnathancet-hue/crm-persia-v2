# Auditoria de Paridade — Chat de Grupos × Chat Individual (envio/recebimento + UX/UI)

> Auditoria READ-ONLY (nenhum código alterado). 3 agentes: inventário do chat 1:1, inventário do chat de grupos, capacidades da UAZAPI v2 para grupos. Fonte de verdade: o código. Gerado em 2026-06-11.

**Pergunta respondida:** o que falta no chat de **grupos** para igualar as funcionalidades de envio e recebimento (e a UX/UI) do chat **individual**?

---

## 0. Veredito executivo

O chat de grupos está **~70% do caminho** em envio e **~80% em recebimento**, mas com três problemas estruturais antes de falar de features:

1. **Existem DOIS chats de grupo divergentes**: o embutido em `/groups` (`groups-client.tsx`, 3.153 linhas — UI principal) e a página `/groups/[id]` (`group-detail-client.tsx`, 1.654 linhas — **órfã, nenhum link aponta pra ela**). Cada um tem features que o outro não tem (ver §2). Qualquer trabalho de paridade precisa começar decidindo o destino da órfã.
2. **Bug de recebimento (High)**: o branch de grupo do webhook roda **antes** do check `isFromMe` e **sem dedup por `whatsapp_msg_id`** ([route.ts:292](apps/crm/src/app/api/whatsapp/webhook/route.ts:292) vs check fromMe em :484; `parseWebhook` não descarta fromMe — uazapi.ts:530). Mensagem enviada do celular num grupo pode entrar como "inbound" duplicada, contar como não lida e tocar som. O 1:1 tem dedup UNIQUE 23505-safe e espelha fromMe como "agent" — grupos não.
3. **Quase nada falta na API**: dos gaps encontrados, só ACK por participante e typing em grupo são incerteza real da UAZAPI. Todo o resto é trabalho no CRM (e dois itens são plumbing de 5 linhas no provider).

---

## 1. Matriz de paridade (resumo)

Legenda: ✅ completo · ⚠️ parcial · ❌ ausente. **GC** = groups-client (UI principal) · **GD** = group-detail (órfã). "API" = UAZAPI suporta em grupos?

| Feature | 1:1 | GC | GD | API |
|---|---|---|---|---|
| **ENVIO** |
| Texto (Enter/Shift+Enter) | ✅ | ✅ | ✅ | ✅ |
| Bolha otimista de TEXTO | ✅ | ❌ (input trava esperando) | ❌ | n/a |
| Status sending→sent→delivered→read→failed | ✅ | ✅ (ticks via `messages_update`→`group_messages.status`, route.ts:236) | ❌ não renderiza | ⚠️ agregado (por participante não documentado) |
| Retry real de falhada | ✅ reenvia | ⚠️ só restaura texto no input | ❌ | ✅ |
| Imagem c/ preview+caption | ✅ | ✅ | ✅ | ✅ |
| Vídeo | ⚠️ (só via picker de documento) | ✅ | ✅ | ✅ |
| Documento | ✅ | ✅ | ✅ | ✅ |
| Áudio gravado (PTT) | ⚠️ sem preview pré-envio | ⚠️ idem | ⚠️ idem | ✅ |
| Bolha otimista de mídia | ✅ | ✅ | ✅ | n/a |
| Reply/citar | ✅ (quote renderizado + scroll-to) | ⚠️ envia e renderiza quote; sem scroll-to | ⚠️ envia; não renderiza quote recebido | ✅ (`replyid`) |
| Encaminhar | ⚠️ (só texto, 10×20) | ❌ | ❌ | ✅ |
| Editar enviada | ✅ | ❌ **(só a órfã tem!)** | ✅ sem indicador "editada" | ✅ |
| Apagar enviada | ✅ (2 opções + confirm) | ✅ | ⚠️ sem confirm; "p/ mim" não persiste | ✅ |
| Reações (enviar) | ✅ persistido em metadata | ⚠️ **não persiste em DB** (some no reload) | ⚠️ idem | ✅ |
| Emoji picker | ✅ | ✅ | ✅ (refoca; GC não) | n/a |
| Agendamento de mensagem | ✅ (mídia só imagem) | ✅ (idem; `min=` em UTC) | ❌ | ✅ |
| Templates/prontas | ✅ Meta 24h | ❌ (Meta não se aplica a grupo; "prontas" não existe) | ❌ | n/a |
| Sugestão de IA | ⚠️ só "copiar" | ✅ **melhor que o 1:1** ("Usar no campo" + regenerar) | ❌ | n/a |
| Limite de caracteres | ❌ | ❌ (só no agendamento) | ❌ | n/a |
| Foco volta ao input pós-envio | ✅ | ❌ | ❌ | n/a |
| Menção @ participante | n/a | ❌ | ❌ | ✅ (`mentions` — client não expõe) |
| Fixar mensagem | ✅ | ✅ | ❌ | ✅ |
| **RECEBIMENTO** |
| Realtime INSERT+UPDATE | ✅ | ✅ (4 canais) | ✅ | ✅ |
| Fallback de polling se canal cai | ✅ 5s | ❌ | ❌ | n/a |
| Som de notificação | ✅ global | ⚠️ só no grupo ABERTO; demais = toast sem som | ⚠️ idem | n/a |
| Notificação desktop | ⚠️ é toast in-app | ⚠️ toast | ❌ | n/a |
| Badge não lidas | ✅ DB + total sidebar + título aba | ⚠️ funciona, mas read-state em **localStorage** (por dispositivo, não compartilhado entre operadores) | — | n/a |
| Marcar lida + ACK ao WhatsApp | ✅ `markChatRead` | ❌ nenhum ACK | ❌ | ⚠️ API ok, mas `phoneToJid()` **destrói** JID `@g.us` (uazapi-client.ts:602) |
| Preview última msg + ordenação | ✅ desnormalizado | ⚠️ bug: outbound não atualiza preview/ordem (groups-client:3210-3216) | — | n/a |
| Imagem/vídeo/áudio/doc/sticker | ✅ | ✅ (doc sem nome do arquivo — metadata existe!) | ⚠️ (doc com nome ✅) | ✅ |
| Localização | ✅ card OSM+endereço | ❌ **(GD órfã tem!)** | ✅ | ✅ (webhook já grava metadata) |
| Contato (vCard) | ✅ | ❌ (provider parseia, UI não renderiza) | ❌ | ✅ |
| Reação recebida do lead | ❌ | ❌ | ❌ | ✅ (gap comum: parseWebhook não trata reactionMessage) |
| Editada/apagada pelo remetente | ❌ | ❌ | ❌ | ⚠️ (revoke/protocolMessage não parseado) |
| Media viewer | ⚠️ sem zoom | ✅ mesmo viewer | ❌ `<a target=_blank>` | n/a |
| Separadores de data PT-BR | ✅ | ✅ | ✅ (formato diverge) | n/a |
| Paginação preservando scroll | ✅ 50/pág | ✅ 50/pág | ❌ **bug: carrega as 50 MAIS ANTIGAS** (`ascending: true` + limit) e não filtra `is_deleted` | n/a |
| Busca na conversa | ⚠️ client-side, some <lg | ⚠️ idem | ⚠️ com contador | n/a |
| Identidade do remetente | ✅ | ✅ (cores por participante; 8 hex hardcoded) | ⚠️ sem cores | ✅ (`sender_pn`/@lid) |
| Vínculo remetente→lead | ✅ | ✅ match forte + painel; ❌ sem "Abrir chat 1:1"/"Criar lead" no menu | ✅ tem os dois | n/a |
| Transcrição de áudio recebido | ✅ | ✅ | ✅ | ✅ |

---

## 2. Problema estrutural — os dois chats de grupo

`group-detail-client.tsx` (**órfã** — zero links no app) e `groups-client.tsx` divergiram:

- **Só a órfã (GD) tem**: editar mensagem, render de localização, nome do arquivo em documento, "Abrir chat 1:1", "Criar lead do participante", paste Ctrl+V de imagem, busca com contador de resultados, refocus pós-emoji.
- **Só a principal (GC) tem**: status/ticks, agendamento, sugestão de IA, bulk delete, paginação, media viewer, cores por participante, painel de membros/configurações do grupo, fixar mensagem.
- **Triplicação**: `AudioPlayer`+waveform copiado 3× (chat 1:1, GC, GD — com comentário literal "same as chat-window.tsx"); `formatMsgTime`, avatar hash, `QUICK_REACTIONS`, `safeAvatarUrl` duplicados.

**Recomendação**: matar a GD (portando as 7 features exclusivas pra GC) OU extrair um `GroupChatWindow` único — e no mesmo movimento extrair `AudioPlayer`/helpers de bolha para módulo compartilhado com o chat 1:1 (candidato: `apps/crm/src/components/chat/shared/` já que chat é CRM-only).

## 3. Gaps para igualar — priorizados

### A. Bugs de recebimento (corrigir antes de features)
1. **[High] fromMe em grupo vira "inbound" duplicado**: branch de grupo antes do check fromMe + insert sem dedup por `whatsapp_msg_id` (route.ts:292-476 vs :484). Fix: mover check fromMe pra antes (espelhar como `direction: "outbound"`, como o 1:1 faz) + UNIQUE/upsert por (group_id, whatsapp_msg_id).
2. **[High] GD carrega as 50 mensagens mais antigas** (`[id]/page.tsx:53-54` `ascending: true` + `limit(50)`) e não filtra `is_deleted` — se a GD for mantida.
3. **[Medium] Preview/ordenação da lista não atualiza em outbound** (groups-client:3210-3216 retorna cedo quando `direction !== "inbound"`).
4. **[Medium] Soft-delete não some em realtime**: handler de UPDATE não remove msg com `is_deleted=true` — só no reload.
5. **[Medium] Sem fallback de polling**: grupos são 100% realtime; se o canal cair (bug conhecido do chat), congela em silêncio. O 1:1 tem polling 5s — replicar.

### B. Paridade de envio — API pronta, falta CRM
6. **Bolha otimista de texto** (1:1 tem; em grupos o input trava `disabled` esperando o server) + **foco volta ao input** pós-envio.
7. **Retry real de falhada** (hoje só restaura o texto; o 1:1 reenvia via `resendMessage` — replicar com suporte a mídia).
8. **Editar mensagem na UI principal** (action `editGroupMessage` e provider já existem — a GC só não tem o item de menu; adicionar indicador "Editada").
9. **Reações persistidas**: hoje `reactToGroupMessage` só chama o provider — persistir em `group_messages.metadata.reactions` (como o 1:1) pra sobreviver ao reload e aparecer pros outros operadores; parsear reação recebida no webhook (gap comum com o 1:1).
10. **Encaminhar** (não existe em grupos; o do 1:1 é só-texto — dá pra compartilhar a mesma UI/limites).
11. **Menção @**: API tem campo `mentions` em todos os `/send/*`; já existe em `SendCommonOptions` do client — falta expor no `WhatsAppProvider`/adapter (plumbing) + autocomplete de participantes no composer (os dados de membros já existem no painel).
12. **Confirmação no apagar da GD** + persistir "apagar para mim" (se GD viver).

### C. Paridade de recebimento — falta CRM
13. **Localização e contato na GC**: webhook já grava `metadata` de location; GD já tem o card — portar pra GC (e renderizar vCard nos dois chats).
14. **Nome do arquivo em documento na GC** (`metadata.file_name` já existe; GD mostra).
15. **ACK de leitura ao WhatsApp + read-state em DB**: criar variante group-safe de `markChatRead` (o `phoneToJid()` atual destrói `@g.us` — uazapi-client.ts:602-605) e mover `groups_last_seen_at` de localStorage pra tabela (por usuário), pra não-lidas serem consistentes entre dispositivos/operadores.
16. **Som global + título da aba**: hoje só toca som no grupo aberto; mensagens de outros grupos viram toast mudo. Reusar `useNotification` do 1:1 (que também precisa do fix de desktop Notification API — gap comum).
17. **Status na GD** (não renderiza ticks — campo já existe e é atualizado).

### D. Limitação/incerteza real da API (não dá pra prometer)
- **ACK por participante** em grupo: não documentado (provável só status agregado — mesmo comportamento do WhatsApp Web). Ticks agregados já funcionam.
- **Typing/presença em grupo**: endpoint aceita `number` genérico mas comportamento com `@g.us` não documentado — exigiria smoke test.
- **Webhook de rename/foto de grupo**: só join/leave confirmado; rename hoje exige re-sync manual (o botão de sync existe, mas dá `window.location.reload()` — melhorar pra refresh de estado).

## 4. Paridade UX/UI

- **Composer**: GC usa `<textarea>` cru (1:1 também — gap comum); GD usa `Textarea` do DS. 18 `<button>` crus nos dois arquivos de grupo (quick reactions, AudioPlayer, thumbs).
- **A11y**: enviar/gravar/emoji TÊM aria-label em grupos (bom); faltam: play/pause e velocidade do AudioPlayer, quick reactions, "Reagir"/"Mais opções" (só `title`), thumbs com `alt=""`, busca sem label. Mesma classe de gaps do 1:1 — corrigir junto.
- **Tokens**: bolhas usam `--chat-bubble-*` ✅; mas `SENDER_COLORS` (8 hex) e `GROUP_AVATar_COLORS` (`bg-red-500`...) hardcoded — mesma exceção documentada dos avatars? Não: só a paleta de avatar é exceção; cores de sender deveriam virar tokens ou exceção documentada. GD sem cores por participante (tudo `text-primary`).
- **Tipografia**: 68 `text-[Npx]` nos 2 arquivos de grupo (vs ~20 no chat 1:1) — `text-[9px]` no badge "Lead" é ilegível.
- **PT-BR**: GC com "Voce", "Video/Audio/Midia", "Telefone nao disponivel", "Anuncio", "Identificar leads pelos historico" (sic, agramatical); actions com "Grupo nao encontrado", "Erro ao enviar midia". GD está corretamente acentuada — mais evidência do drift.
- **Empty states**: usam `EmptyState` do DS ✅ mas sem CTA clicável (1:1 idem — gap comum).
- **Loading**: spinner sem skeleton (1:1 idem — gap comum).
- **Mobile**: master-detail colapsa ✅; busca na conversa some no mobile (1:1 idem); sem swipe-reply.
- **Erros silenciosos**: bulk delete com catch vazio, queries de unread sem catch, sync com `window.location.reload()`.

## 5. O que GRUPOS tem e o 1:1 NÃO tem (paridade inversa, de brinde)

- Sugestão de IA com "Usar no campo" + regenerar (1:1 só "copiar" — portar pro 1:1).
- Cores por participante nas bolhas (irrelevante pro 1:1).
- Vídeo com picker dedicado (`accept="image/*,video/*"`; no 1:1 vídeo só entra como "documento").
- Paste Ctrl+V de imagem na GD (o 1:1 TEM paste; a GC não).
- Gaps COMUNS aos dois (corrigir uma vez, valer pros dois): reação/edição/revoke recebidos não parseados; áudio sem preview pré-envio; sem limite de caracteres no composer; busca client-side; desktop notify é toast in-app; sem skeleton; empty sem CTA.

## 6. Plano sugerido (ordem)

1. **PR-G1 (bugs de recebimento)**: fromMe+dedup no webhook de grupos, preview outbound, soft-delete em realtime, polling fallback. *(itens A)*
2. **PR-G2 (decisão estrutural)**: matar ou linkar a GD; portar as 7 features exclusivas pra GC; extrair AudioPlayer/helpers compartilhados.
3. **PR-G3 (paridade de envio)**: otimista de texto + foco, retry real, editar na GC, reações persistidas, nome de arquivo em doc, localização/contato na GC.
4. **PR-G4 (read-state)**: ACK group-safe (`markChatRead` variante JID) + `group_last_seen` em DB + som global/título de aba.
5. **PR-G5 (menções @)**: plumbing `mentions` no provider + autocomplete de participantes.
6. **PR-G6 (UX/UI)**: aria-labels, acentos, tokens das cores de sender, encaminhar compartilhado.
