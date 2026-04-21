import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { businessName, niche, description, services, schedule, address } = body;

  // If OpenAI key is configured, use it
  if (process.env.OPENAI_API_KEY) {
    try {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Voce e um especialista em criar assistentes virtuais para WhatsApp.
Gere configuracoes personalizadas para um assistente virtual baseado nas informacoes do negocio.
Responda SOMENTE em JSON valido, sem markdown, sem explicacoes.
Formato:
{
  "prompt": "prompt completo para o assistente",
  "welcomeMsg": "mensagem de boas-vindas",
  "offHoursMsg": "mensagem fora do horario",
  "qualificationQuestions": ["pergunta1", "pergunta2", "pergunta3"]
}`
          },
          {
            role: "user",
            content: `Negocio: ${businessName}
Nicho: ${niche}
Descricao: ${description}
Servicos: ${services}
Horario: ${schedule}
Endereco: ${address || "Nao informado"}

Crie um assistente virtual profissional e cordial para este negocio.`
          }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      });

      const config = JSON.parse(completion.choices[0].message.content || "{}");
      return NextResponse.json(config);
    } catch (error: any) {
      console.error("OpenAI error:", error.message);
      // Fallback to template
    }
  }

  // Fallback: generate without OpenAI using templates
  const nicheTemplates: Record<string, string> = {
    advocacia: "Voce e o assistente virtual do escritorio de advocacia",
    clinica: "Voce e o assistente virtual da clinica",
    imobiliaria: "Voce e o assistente virtual da imobiliaria",
    ecommerce: "Voce e o assistente virtual da loja",
    agencia: "Voce e o assistente virtual da agencia",
    educacao: "Voce e o assistente virtual da escola",
    restaurante: "Voce e o assistente virtual do restaurante",
    beleza: "Voce e o assistente virtual do salao",
    contabilidade: "Voce e o assistente virtual do escritorio contabil",
    tecnologia: "Voce e o assistente virtual da empresa",
  };

  const intro = nicheTemplates[niche] || "Voce e o assistente virtual da empresa";

  const prompt = `${intro} ${businessName}.

Sua funcao e recepcionar e atender clientes pelo WhatsApp de forma profissional e cordial.

Sobre o negocio: ${description || businessName}

Servicos oferecidos: ${services || "Diversos servicos"}

Horario de atendimento: ${schedule || "Horario comercial"}

${address ? `Endereco: ${address}` : ""}

Instrucoes:
- Cumprimente de forma cordial e profissional
- Pergunte como pode ajudar
- Se o cliente perguntar sobre servicos, informe os disponiveis
- Se precisar de atendimento humano, informe que vai transferir
- Nunca invente informacoes que nao foram fornecidas
- Seja breve e objetivo nas respostas`;

  const welcomeMsg = `Ola! Bem-vindo(a) a ${businessName}! Sou o assistente virtual. Como posso ajudar voce hoje?`;

  const offHoursMsg = `Obrigado por entrar em contato com ${businessName}! Nosso horario de atendimento e ${schedule || "horario comercial"}. Deixe sua mensagem que responderemos assim que possivel!`;

  return NextResponse.json({
    prompt,
    welcomeMsg,
    offHoursMsg,
    qualificationQuestions: [
      "Como posso ajudar voce hoje?",
      "Voce ja e nosso cliente?",
      "Qual servico voce precisa?",
    ],
  });
}
