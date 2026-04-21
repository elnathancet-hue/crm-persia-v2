import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";

let client: OpenAI | null = null;

export function createOpenAIClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY não configurada");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

/** Text-only message */
interface ChatMessageText {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Multimodal message (vision) */
interface ChatMessageMultimodal {
  role: "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
}

export type ChatMessage = ChatMessageText | ChatMessageMultimodal;

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export async function chatCompletion(
  systemPrompt: string,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const openai = createOpenAIClient();

  const {
    model = "gpt-4o-mini",
    temperature = 0.7,
    maxTokens = 1024,
    topP = 0.9,
    frequencyPenalty = 0.3,
    presencePenalty = 0.1,
  } = options;

  // Build messages array compatible with OpenAI types
  const allMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((msg) => {
      if (typeof msg.content === "string") {
        return {
          role: msg.role as "user" | "assistant",
          content: msg.content,
        } satisfies ChatCompletionMessageParam;
      }
      // Multimodal content (vision)
      return {
        role: "user" as const,
        content: msg.content as ChatCompletionContentPart[],
      } satisfies ChatCompletionMessageParam;
    }),
  ];

  // Use a vision-capable model when multimodal content is present
  const hasVision = messages.some((m) => Array.isArray(m.content));
  const effectiveModel = hasVision ? "gpt-4o" : model;

  const response = await openai.chat.completions.create({
    model: effectiveModel,
    messages: allMessages,
    temperature,
    max_tokens: maxTokens,
    top_p: topP,
    frequency_penalty: frequencyPenalty,
    presence_penalty: presencePenalty,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Sem resposta da IA");

  return content;
}
