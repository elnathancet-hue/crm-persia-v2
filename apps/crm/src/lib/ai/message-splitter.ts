import { chatCompletion } from "./openai";

export interface SplitConfig {
  enabled: boolean;
  threshold: number;
  delay_seconds: number;
}

const DEFAULT_CONFIG: SplitConfig = {
  enabled: false,
  threshold: 100,
  delay_seconds: 2,
};

export function parseSplitConfig(raw: unknown): SplitConfig {
  if (raw && typeof raw === "object" && "enabled" in raw) {
    const r = raw as Record<string, unknown>;
    return {
      enabled: Boolean(r.enabled),
      threshold: typeof r.threshold === "number" ? r.threshold : 100,
      delay_seconds: typeof r.delay_seconds === "number" ? r.delay_seconds : 2,
    };
  }
  return DEFAULT_CONFIG;
}

const SPLIT_PROMPT =
  "Divida o texto em mensagens curtas e naturais, como se fossem mensagens de WhatsApp. " +
  "Retorne SOMENTE as mensagens usando o delimitador <MSG> e </MSG>. " +
  "NAO retorne JSON. NAO use markdown. NAO escreva nada fora das tags. " +
  "Exemplo: <MSG>Mensagem 1</MSG><MSG>Mensagem 2</MSG><MSG>Mensagem 3</MSG>";

/**
 * Splits a long AI response into multiple natural WhatsApp-style messages.
 * Uses GPT to determine natural split points.
 * Returns the original text as a single-element array if splitting is not needed.
 */
export async function splitMessage(
  text: string,
  config: SplitConfig
): Promise<string[]> {
  if (!config.enabled || text.length < config.threshold) {
    return [text];
  }

  try {
    const result = await chatCompletion(
      SPLIT_PROMPT,
      [{ role: "user", content: `Mensagem para cortar e formatar: ${text}` }],
      { model: "gpt-4.1-mini", temperature: 0.3, maxTokens: 2048 }
    );

    const matches = [...result.matchAll(/<MSG>([\s\S]*?)<\/MSG>/g)];
    const messages = matches
      .map((m) => (m[1] || "").trim())
      .filter(Boolean);

    // Fallback: if parsing failed, return original
    if (messages.length === 0) {
      return [text];
    }

    return messages;
  } catch (err) {
    console.error("[MessageSplitter] Error splitting message:", err);
    return [text];
  }
}
