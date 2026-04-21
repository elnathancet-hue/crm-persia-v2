import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

let client: OpenAI | null = null;

function createOpenAIClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY nao configurada");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function chatCompletion(
  systemPrompt: string,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const openai = createOpenAIClient();

  const {
    model = "gpt-4.1-mini",
    temperature = 0.7,
    maxTokens = 1024,
  } = options;

  const allMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }) satisfies ChatCompletionMessageParam),
  ];

  const response = await openai.chat.completions.create({
    model,
    messages: allMessages,
    temperature,
    max_tokens: maxTokens,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Sem resposta da IA");

  return content;
}
