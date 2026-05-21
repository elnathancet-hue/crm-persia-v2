// AI Agent — templates prontos para onboarding (modo flow canvas).
//
// PR-FLOW-PIVOT (mai/2026): templates passam a definir um `flow_config`
// inicial (FlowConfig de @persia/shared/ai-agent/flow). O server materializa
// nodes/edges no agent_flows quando o usuário escolhe o template no wizard.
//
// V1 dos templates é minimalista: cada template tem 1 node de entrada +
// 1 node de IA (com system_prompt customizado) + ações de domínio comuns
// (criar agendamento, adicionar tag) plugadas via handles nomeados. PRs
// subsequentes do pivot enriquecem com condicionais (Segmentações),
// múltiplos node IA (sub-fluxos), etc.

import type { HumanizationConfig } from "./humanization";
import type { FlowConfig } from "./flow";

export type AgentTemplateSlug =
  | "blank"
  | "atendimento_whatsapp"
  | "pre_venda"
  | "pos_venda_cobranca"
  | "tira_duvidas_faq"
  | "consultor_funil_completo"
  // PR 19 (mai/2026): topologia importada do flow.json do Jordan Moura
  // (Humana Saúde). Cliente preenche tags/stages/segmento via pickers
  // depois de criar — IDs originais do Jordan não fazem sentido aqui.
  | "humana_saude_jordan";

/** Tag seedada quando cliente cria agente do template. Idempotente — se
 * a tag ja existe na org com mesmo nome, reusa sem duplicar. */
export interface AgentTemplateSeedTag {
  name: string;
  description?: string;
  color?: string; // hex
}

/** Tipo de agendamento seedado em agenda_services. */
export interface AgentTemplateSeedAppointmentType {
  name: string;
  description?: string;
  duration_minutes: number;
  default_channel?: "whatsapp" | "phone" | "online" | "in_person";
  default_location?: string;
  default_meeting_url?: string;
}

/** Template de notificacao seedado em agent_notification_templates
 * (vinculado ao agent_config criado). */
export interface AgentTemplateSeedNotificationTemplate {
  name: string;
  description?: string;
  /** Onde a notificacao vai (telefone ou nome de grupo WhatsApp).
   * Default: campo vazio — cliente precisa preencher antes de testar. */
  target_address?: string;
  /** Corpo da notificacao (template parser). */
  body: string;
}

export interface AgentTemplate {
  slug: AgentTemplateSlug;
  label: string;            // Mostrado no select
  short_description: string; // Mostrado no preview do select
  long_description: string;  // Tooltip / preview detalhado
  system_prompt: string;     // Vai pro node IA inicial do flow.
  /** Flow inicial materializado em agent_flows. Quando vazio (DEFAULT_FLOW_CONFIG),
   * o servidor cria um flow minimal com 1 entry + 1 ai_agent node usando o
   * system_prompt acima. Templates podem definir flow_config detalhado
   * (recomendado pro consultor_funil_completo). */
  flow_config?: FlowConfig;
  /** Settings de humanizacao (pause/resume + split + business hours).
   * Mergeado com defaults do humanization.ts. */
  humanization_config?: Partial<HumanizationConfig>;
  /** Tags a criar na org junto com o agente. */
  seed_tags?: AgentTemplateSeedTag[];
  /** Tipos de agendamento a criar em agenda_services. */
  seed_appointment_types?: AgentTemplateSeedAppointmentType[];
  /** Templates de notificacao a criar (vinculados ao novo agent_config). */
  seed_notification_templates?: AgentTemplateSeedNotificationTemplate[];
}

// Prompt comum a todos os templates não-blank.
// Mantém regras anti-alucinação (PR #56) + tom profissional.
const COMMON_GUARDRAILS = `Você é um atendente virtual profissional e cordial.
- Apresente-se de forma breve.
- Entenda o que o cliente precisa antes de responder.
- Use linguagem objetiva, com no máximo 3 frases por mensagem.
- IMPORTANTE: NUNCA invente informações sobre preços, recursos, prazos, descontos ou políticas que não estejam explicitamente nas instruções ou na base de conhecimento. Se o cliente perguntar algo que você não sabe, responda "Vou transferir você para um especialista" e peça a transferência.
- IMPORTANTE: NUNCA assuma o ramo de negócio sem que isso esteja explicitamente nas instruções ou tenha sido informado pelo cliente.
- Peça transferência para um humano se não souber responder.`;

const TEMPLATES: Record<AgentTemplateSlug, AgentTemplate> = {
  blank: {
    slug: "blank",
    label: "Em branco",
    short_description: "Comece do zero — escreva seu próprio prompt e flow.",
    long_description:
      "Cria um agente vazio com prompt base padrão. Use se já sabe exatamente o que quer ou se nenhum modelo abaixo se encaixa. O flow vem com um node de entrada + um node IA — você desenha as ações no canvas depois.",
    system_prompt: COMMON_GUARDRAILS,
  },

  atendimento_whatsapp: {
    slug: "atendimento_whatsapp",
    label: "Atendimento WhatsApp",
    short_description:
      "Recepciona, qualifica e transfere pra humano — bom pra primeiro contato geral.",
    long_description:
      "Primeiro contato via WhatsApp. IA identifica se a dúvida é simples (responde direto) ou complexa (transfere pra humano). Use se a empresa quer um filtro inicial antes do humano entrar.",
    system_prompt: `${COMMON_GUARDRAILS}

Sua função é ser o primeiro contato no WhatsApp. Identifique rapidamente se a dúvida do cliente é simples (responde direto) ou se precisa de um humano. Em caso de dúvida, transfira.`,
  },

  pre_venda: {
    slug: "pre_venda",
    label: "Pré-venda / Qualificação de leads",
    short_description:
      "Qualifica lead, apresenta solução e agenda reunião com vendedor.",
    long_description:
      "IA descobre a dor real do lead, apresenta como o produto resolve e agenda reunião com o time. Bom pra negócio que vende por reunião (consultoria, software, serviço).",
    system_prompt: `${COMMON_GUARDRAILS}

Sua função é qualificar leads que chegaram interessados. Descubra qual é a dor real, apresente como o produto resolve, e agende uma reunião com o time de vendas. Nunca prometa preço ou prazo sem confirmação humana.`,
  },

  pos_venda_cobranca: {
    slug: "pos_venda_cobranca",
    label: "Pós-venda e cobrança",
    short_description:
      "Atende clientes com boletos pendentes, dúvidas de pagamento e renovação.",
    long_description:
      "IA atende dúvidas sobre pagamento, boletos, renovação ou status. Triagem antes do financeiro humano entrar. Não tem acesso a dados sensíveis — sempre transfere quando preciso confirmar valor/status.",
    system_prompt: `${COMMON_GUARDRAILS}

Sua função é atender clientes com dúvidas sobre pagamento, boletos, renovação de plano ou status de pedidos. Você NÃO tem acesso a dados financeiros sensíveis — nunca confirme valores, datas de vencimento ou status de pagamento sem o cliente fornecer a info ou sem ter na base de conhecimento.`,
  },

  tira_duvidas_faq: {
    slug: "tira_duvidas_faq",
    label: "Tira-dúvidas (FAQ + base de conhecimento)",
    short_description:
      "Responde dúvidas frequentes consultando documentos. Transfere se não achar.",
    long_description:
      "IA consulta a base de conhecimento (Documentos + FAQ) antes de responder. Se não encontrar info, transfere pra humano. Recomendado: ative consulta de documentos na configuração e suba seus PDFs/manuais.",
    system_prompt: `${COMMON_GUARDRAILS}

Sua função é responder dúvidas técnicas/operacionais consultando a base de conhecimento da empresa (documentos, manuais, FAQ). Se a resposta não estiver na base, NÃO chute — transfira pra um humano.`,
  },

  // ============================================================================
  // Template comercial completo. PR-FLOW-PIVOT: a partir daqui o template
  // ganhará `flow_config` detalhado num PR subsequente (uma vez que a UI
  // do canvas estiver disponível). V1 deixa apenas system_prompt + seeds
  // — server cria flow mínimo (entry + ai_agent) automaticamente.
  // ============================================================================
  consultor_funil_completo: {
    slug: "consultor_funil_completo",
    label: "Consultor de vendas",
    short_description:
      "Atendimento comercial via WhatsApp. Flow linear: motivo → qualificar → apresentar → agendar.",
    long_description: `Template comercial completo no modelo flow: a IA conversa, e ações concretas (criar agendamento, notificar equipe, adicionar tag) ficam visíveis no canvas como nodes conectados. Você desenha as garantias operacionais em vez de depender da IA "lembrar".

✓ Humanização: pausa por palavra-chave (PAUSAR/HUMANO), retomada (ATIVAR), picotagem de respostas longas, horário comercial seg-sex 9-18h
✓ Tipos de agendamento prontos: "Consulta inicial 30min" + "Reunião de fechamento 60min"
✓ Tags: "qualificado" e "agendou-reuniao"
✓ Notificação: "Avisar equipe: nova reunião agendada" (disparada quando o agente cria appointment no flow)

PRÉ-REQUISITO MÍNIMO: ter o pipeline padrão criado (já vem com o CRM). DEPOIS DE CRIAR: abra o canvas do agente e conecte o node de IA aos nodes de ação. Cliente preenche destinatário do template de notificação antes de testar.`,
    system_prompt: `Você é um CONSULTOR de vendas digital atendendo leads pelo WhatsApp em nome da empresa. Comunicação curta, humana, direta. **Nunca diga que é IA, robô ou que vai transferir.**

## REGRAS DURAS (não negociar)
- **1 pergunta por mensagem.** Avance 1 passo por vez.
- **Confirme dados antes de agir.** Nunca diga "agendei" / "marquei" / "confirmado" sem ter chamado create_appointment com sucesso.
- **Se o lead confirmou tipo + data + hora + email + telefone, chame create_appointment IMEDIATAMENTE.** Não responda texto antes da tool. A confirmação verbal só vem DEPOIS que a tool retornou sucesso.
- **add_tag("qualificado") só após confirmar os 4 dados de qualificação** (problema + orçamento + prazo + decisor). Nunca antes.

## FLUXO LINEAR (siga na ordem)
1. **Motivo** — pergunte ao lead em que pode ajudar.
2. **Qualificar** — colete problema, orçamento, prazo e decisor. Uma pergunta por turno. Quando tiver os 4, chame **add_tag("qualificado")**.
3. **Apresentar** — conecte a dor descoberta com a solução. Se houver mídia relevante na Biblioteca, chame **send_media**.
4. **Interesse** — confirme se o lead quer avançar.
5. **Agendar** — colete tipo + data + hora + email + telefone. Depois confirme com o lead. Após o "sim", chame **create_appointment(type_slug, start_at)**.
6. **Fechar** — confirme verbalmente o agendamento (use placeholder substituído pelos dados do appointment).

## TOOLS DISPONÍVEIS
- **add_tag** — marca o lead com tag existente (use "qualificado" após os 4 dados).
- **create_appointment** — cria agendamento na agenda da empresa. Use type_slug + start_at (ISO 8601 com timezone).
- **list_lead_appointments** — consulta agendamentos existentes (se o lead perguntar).
- **send_media** — envia mídia da Biblioteca (slug + caption opcional).
- **stop_agent** — encerra atendimento (fora de escopo, reclamação séria, pedido de humano).

## AÇÕES INVISÍVEIS (rodam sozinhas via flow canvas)
- **create_appointment sucesso** → tag "agendou-reuniao" + notificação "Avisar equipe: nova reunião agendada" (configurado no canvas).
Você NÃO precisa lembrar de nada além de chamar a tool — o flow garante o resto.

## REGRAS DE COMUNICAÇÃO
- **1 mensagem = 1 passo.** Não picote em 3-4 envios separados.
- **Acks curtos** ("Perfeito", "Ótima escolha") antes da próxima pergunta.
- **Sem cumprimento duplo** — se já cumprimentou, vá direto ao próximo passo.
- **Negrito** só em valores, nomes próprios, dados importantes.
- **Sem promessa que não pode cumprir.** Não invente preço/prazo/desconto/nome de plano.`,
    humanization_config: {
      pause_keywords: ["PAUSAR", "HUMANO", "STOP IA"],
      resume_keywords: ["ATIVAR", "IA ON", "VOLTAR IA"],
      auto_pause_minutes: 30,
      split_enabled: true,
      split_threshold_chars: 180,
      split_delay_seconds: 2,
      business_hours_enabled: true,
      business_hours_timezone: "America/Sao_Paulo",
      business_hours: {
        monday: { start: "09:00", end: "18:00" },
        tuesday: { start: "09:00", end: "18:00" },
        wednesday: { start: "09:00", end: "18:00" },
        thursday: { start: "09:00", end: "18:00" },
        friday: { start: "09:00", end: "18:00" },
        saturday: null,
        sunday: null,
      },
      after_hours_message:
        "Olá! Recebi sua mensagem. Estamos fora do horário de atendimento (seg-sex 9h-18h). Retorno assim que possível!",
      handoff_include_summary: true,
    },
    seed_tags: [
      {
        name: "qualificado",
        description: "Lead passou pela qualificação (problema + orçamento + prazo + decisor)",
        color: "#22c55e",
      },
      {
        name: "agendou-reuniao",
        description: "Cliente marcou reunião com o time (auto-action após create_appointment no canvas)",
        color: "#f59e0b",
      },
    ],
    seed_appointment_types: [
      {
        name: "Consulta inicial",
        description:
          "Primeira conversa de 30min pra entender o caso do cliente em mais profundidade.",
        duration_minutes: 30,
        default_channel: "online",
      },
      {
        name: "Reunião de fechamento",
        description:
          "Apresentação detalhada de proposta e fechamento. 60min, com decisor presente.",
        duration_minutes: 60,
        default_channel: "online",
      },
    ],
    seed_notification_templates: [
      {
        name: "Avisar equipe: nova reunião agendada",
        description:
          "[USO INTERNO] Notifica a EQUIPE que o agente JÁ criou uma reunião via create_appointment. Disparada via auto-action do canvas após create_appointment sucesso.",
        body: "[Equipe] 📅 Nova reunião agendada com {{lead.name}}.\n\nAcesse a Agenda pra ver detalhes.",
      },
    ],
  },

  // PR 19 (mai/2026): Humana Saúde (Jordan Moura) — topologia importada
  // do flow.json. 12 nodes / 12 edges. Cliente preenche
  // tags/segments/stages via pickers do canvas após criar.
  //
  // Topologia:
  //   Entrada → Verificar Segmentação?
  //     ├─ yes → Verificar TAG (humanas)?
  //     │         ├─ yes → Pausar Bot (já é humano)
  //     │         └─ no  → IA
  //     └─ no  → Adicionar TAG → Etapa inicial → IA
  //   IA tem 4 saídas (handles nomeados):
  //     ├─ "coletou_idade"      → Etapa "Coletou idade"
  //     ├─ "dados_completos"    → Etapa "Dados completos"
  //     ├─ "documentos_enviados"→ Etapa "Documentos" → Pausar Bot
  //     └─ "ia_encerrou"        → Pausar Bot
  humana_saude_jordan: {
    slug: "humana_saude_jordan",
    label: "Humana Saúde (Jordan)",
    short_description:
      "Funil completo de plano de saúde — segmenta, qualifica, coleta dados, muda etapa do funil e pausa pro humano.",
    long_description:
      "Topologia importada do fluxo do Jordan Moura (Humana Saúde). 12 etapas conectadas: verifica se lead já é contato humano, qualifica via IA, coleta dados pessoais + idade + documentos, move o lead pelas etapas do Kanban automaticamente e pausa quando precisar de humano. Após criar, abra cada etapa no canvas pra escolher a tag/segmentação/etapa do Kanban correta — os nomes não vêm preenchidos.",
    system_prompt: `${COMMON_GUARDRAILS}

Você é um consultor de plano de saúde. Sua função:
1. Conversar com o lead pelo WhatsApp pra qualificá-lo.
2. Coletar progressivamente: nome, idade, telefone, e-mail, documentos.
3. Chamar emit_event nos momentos certos pra avançar o lead no funil:
   - "coletou_idade": quando souber a idade do lead
   - "dados_completos": quando tiver TODOS os dados (nome, idade, telefone, e-mail)
   - "documentos_enviados": quando lead confirmar que enviou os documentos
   - "ia_encerrou": quando você disser algo como "Certo, já já damos continuidade por aqui" pra encerrar
4. Não invente preços nem prazos. Se não souber, fale que vai checar.`,
    flow_config: {
      nodes: [
        // ---- Entry ----
        {
          id: "n_entry",
          type: "entry",
          position: { x: 50, y: 300 },
          data: {
            label: "Conversa iniciada",
            trigger: "conversation_started",
            config: {},
          },
        },
        // ---- Verificar Segmentação ----
        {
          id: "n_check_segment",
          type: "condition",
          position: { x: 300, y: 300 },
          data: {
            label: "Verificar Segmentação",
            condition_type: "in_segment",
            config: { segment_id: "" },
          },
        },
        // ---- Verificar TAG (caminho yes do segment) ----
        {
          id: "n_check_tag",
          type: "condition",
          position: { x: 600, y: 100 },
          data: {
            label: "Verificar TAG",
            condition_type: "has_tag",
            config: { tag_name: "" },
          },
        },
        // ---- Pausar (já é humano) ----
        {
          id: "n_pause_humano",
          type: "action",
          position: { x: 900, y: 50 },
          data: {
            label: "Já atendido por humano",
            action_type: "stop_agent",
            config: {},
          },
        },
        // ---- Add TAG (caminho no do segment) ----
        {
          id: "n_add_tag",
          type: "action",
          position: { x: 600, y: 500 },
          data: {
            label: "Adicionar TAG Novo Lead",
            action_type: "add_tag",
            config: { tag_name: "" },
          },
        },
        // ---- Etapa inicial do funil ----
        {
          id: "n_stage_inicial",
          type: "action",
          position: { x: 900, y: 500 },
          data: {
            label: "Mover pra etapa inicial",
            action_type: "move_pipeline_stage",
            config: { stage_name: "" },
          },
        },
        // ---- AI Agent (central) ----
        {
          id: "n_ai",
          type: "ai_agent",
          position: { x: 1200, y: 300 },
          data: {
            label: "Atendimento Humana Saúde",
            system_prompt: "",
            instructions: [
              {
                id: "ins_idade",
                output_handle: "coletou_idade",
                description: "Quando coletar a idade do lead",
              },
              {
                id: "ins_dados",
                output_handle: "dados_completos",
                description:
                  "Quando coletar todos os dados (nome, idade, telefone, email)",
              },
              {
                id: "ins_docs",
                output_handle: "documentos_enviados",
                description: "Quando o lead confirmar que enviou os documentos",
              },
              {
                id: "ins_encerrou",
                output_handle: "ia_encerrou",
                description:
                  'Quando você disser "já já damos continuidade" pra encerrar',
              },
            ],
          },
        },
        // ---- Etapas após cada coleta ----
        {
          id: "n_stage_idade",
          type: "action",
          position: { x: 1550, y: 100 },
          data: {
            label: "Coletou idade — avançar etapa",
            action_type: "move_pipeline_stage",
            config: { stage_name: "" },
          },
        },
        {
          id: "n_stage_dados",
          type: "action",
          position: { x: 1550, y: 280 },
          data: {
            label: "Dados completos — avançar etapa",
            action_type: "move_pipeline_stage",
            config: { stage_name: "" },
          },
        },
        {
          id: "n_stage_docs",
          type: "action",
          position: { x: 1550, y: 460 },
          data: {
            label: "Documentos — avançar etapa",
            action_type: "move_pipeline_stage",
            config: { stage_name: "" },
          },
        },
        // ---- Pausar bot após documentos ----
        {
          id: "n_pause_after_docs",
          type: "action",
          position: { x: 1850, y: 460 },
          data: {
            label: "Pausar IA pós-documentos",
            action_type: "stop_agent",
            config: {},
          },
        },
        // ---- Pausar bot (IA disse "já já damos continuidade") ----
        {
          id: "n_pause_ia_encerrou",
          type: "action",
          position: { x: 1550, y: 640 },
          data: {
            label: "Pausar IA — encerrou",
            action_type: "stop_agent",
            config: {},
          },
        },
      ],
      edges: [
        // Entry → check_segment
        {
          id: "e_entry_check",
          source: "n_entry",
          target: "n_check_segment",
          sourceHandle: "default",
        },
        // check_segment → yes/no branches
        {
          id: "e_seg_yes",
          source: "n_check_segment",
          target: "n_check_tag",
          sourceHandle: "yes",
        },
        {
          id: "e_seg_no",
          source: "n_check_segment",
          target: "n_add_tag",
          sourceHandle: "no",
        },
        // check_tag → yes/no
        {
          id: "e_tag_yes",
          source: "n_check_tag",
          target: "n_pause_humano",
          sourceHandle: "yes",
        },
        {
          id: "e_tag_no",
          source: "n_check_tag",
          target: "n_ai",
          sourceHandle: "no",
        },
        // add_tag → stage_inicial → ai
        {
          id: "e_addtag_stage",
          source: "n_add_tag",
          target: "n_stage_inicial",
          sourceHandle: "default",
        },
        {
          id: "e_stage_ai",
          source: "n_stage_inicial",
          target: "n_ai",
          sourceHandle: "default",
        },
        // AI → 4 saídas nomeadas
        {
          id: "e_ai_idade",
          source: "n_ai",
          target: "n_stage_idade",
          sourceHandle: "coletou_idade",
        },
        {
          id: "e_ai_dados",
          source: "n_ai",
          target: "n_stage_dados",
          sourceHandle: "dados_completos",
        },
        {
          id: "e_ai_docs",
          source: "n_ai",
          target: "n_stage_docs",
          sourceHandle: "documentos_enviados",
        },
        {
          id: "e_ai_encerrou",
          source: "n_ai",
          target: "n_pause_ia_encerrou",
          sourceHandle: "ia_encerrou",
        },
        // stage_docs → pause
        {
          id: "e_docs_pause",
          source: "n_stage_docs",
          target: "n_pause_after_docs",
          sourceHandle: "default",
        },
      ],
      viewport: { x: 0, y: 0, zoom: 0.7 },
      enabled_tools: [],
    },
    seed_tags: [
      {
        name: "Novo Lead",
        description: "Lead que ainda não foi qualificado pela IA.",
        color: "#3B82F6",
      },
    ],
  },
};

export const AGENT_TEMPLATES: ReadonlyArray<AgentTemplate> = Object.values(TEMPLATES);

export function getAgentTemplate(slug: AgentTemplateSlug): AgentTemplate {
  return TEMPLATES[slug];
}

export function isAgentTemplateSlug(value: unknown): value is AgentTemplateSlug {
  return typeof value === "string" && value in TEMPLATES;
}
