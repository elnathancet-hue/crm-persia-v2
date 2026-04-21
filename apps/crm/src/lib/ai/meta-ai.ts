import { chatCompletion } from "./openai";

interface BusinessInfo {
  businessDescription: string;
  services: string;
  schedule: string;
  address: string;
  niche: string;
}

interface AssistantConfig {
  prompt: string;
  welcomeMsg: string;
  offHoursMsg: string;
  qualificationQuestions: string[];
}

export async function generateAssistantConfig(
  info: BusinessInfo
): Promise<AssistantConfig> {
  const systemPrompt = `Voce e a Meta-IA, uma inteligencia artificial especializada em criar configuracoes de assistentes de atendimento via WhatsApp para empresas brasileiras.

Sua tarefa e gerar uma configuracao completa e personalizada para o assistente de IA baseada nas informacoes do negocio fornecidas.

Responda APENAS com um JSON valido, sem markdown, sem explicacoes. O JSON deve ter exatamente esta estrutura:
{
  "prompt": "instrucoes completas para o assistente (minimo 200 palavras, incluindo tom de voz, regras de atendimento, informacoes do negocio, o que pode e nao pode fazer)",
  "welcomeMsg": "mensagem de boas-vindas personalizada para novos contatos",
  "offHoursMsg": "mensagem para quando o atendimento estiver fora do horario",
  "qualificationQuestions": ["pergunta1", "pergunta2", "pergunta3"]
}

Diretrizes para gerar o prompt:
- Inclua todas as informacoes do negocio no prompt
- Defina claramente o que o assistente pode e nao pode fazer
- Instrua o assistente a coletar informacoes do lead naturalmente
- O assistente deve ser proativo mas nao insistente
- Inclua instrucoes para lidar com reclamacoes
- O assistente deve saber encaminhar para atendimento humano quando necessario
- Use linguagem adequada ao nicho do negocio`;

  const userMessage = `Informacoes do negocio:
- Descricao: ${info.businessDescription}
- Servicos/Produtos: ${info.services}
- Horario de funcionamento: ${info.schedule}
- Endereco: ${info.address}
- Nicho: ${info.niche}

Gere a configuracao do assistente de IA.`;

  const response = await chatCompletion(systemPrompt, [
    { role: "user", content: userMessage },
  ], {
    model: "gpt-4o-mini",
    temperature: 0.8,
    maxTokens: 2048,
  });

  try {
    const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const config = JSON.parse(cleaned) as AssistantConfig;

    return {
      prompt: config.prompt || "",
      welcomeMsg: config.welcomeMsg || "",
      offHoursMsg: config.offHoursMsg || "",
      qualificationQuestions: config.qualificationQuestions || [],
    };
  } catch {
    return {
      prompt: `Voce e um assistente de atendimento para ${info.businessDescription}. Servicos: ${info.services}. Horario: ${info.schedule}. Endereco: ${info.address}. Seja cordial, tire duvidas e qualifique os leads.`,
      welcomeMsg: `Ola! Bem-vindo(a)! Como posso ajudar voce hoje?`,
      offHoursMsg: `Nosso horario de atendimento e ${info.schedule}. Deixe sua mensagem que retornaremos assim que possivel!`,
      qualificationQuestions: [
        "Qual seu nome completo?",
        "Como conheceu nosso servico?",
        "Qual sua principal necessidade?",
      ],
    };
  }
}
