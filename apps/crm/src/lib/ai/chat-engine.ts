import { createClient as createServiceClient } from "@supabase/supabase-js";
import { chatCompletion, type ChatMessage } from "./openai";

function getSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface ProcessMessageResult {
  response: string;
  tokensUsed?: number;
  splitMessages?: string[];  // If message was split into multiple
}

interface AssistantConfig {
  id: string;
  prompt: string;
  welcome_msg: string;
  off_hours_msg: string;
  tone: string;
  model: string;
  temperature: number;
  is_active: boolean;
  schedule: { start?: string; end?: string; days?: number[] } | null;
  total_tokens_used: number;
  // New fields
  max_message_length: number;
  typing_delay_seconds: number;
  context_time_window_hours: number;
  context_max_messages: number;
  context_min_messages: number;
  frequency_penalty: number;
  presence_penalty: number;
  top_p: number;
  sign_messages: boolean;
  sign_name: string;
  provider: string;
  split_long_messages: boolean;
}

export async function processMessage(
  assistantId: string,
  conversationId: string,
  leadMessage: string,
  media?: { type: string; url: string }
): Promise<ProcessMessageResult> {
  const supabase = getSupabase();

  // 1. Get assistant config
  const { data: assistant, error: assistantError } = await supabase
    .from("ai_assistants")
    .select("*")
    .eq("id", assistantId)
    .single();

  if (assistantError || !assistant) {
    throw new Error("Assistente nao encontrado");
  }

  const config = assistant as AssistantConfig;

  if (!config.is_active) {
    throw new Error("Assistente esta desativado");
  }

  // 2. Check schedule
  if (config.schedule?.start && config.schedule?.end && config.schedule?.days) {
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    if (!config.schedule.days.includes(currentDay) || currentTime < config.schedule.start || currentTime > config.schedule.end) {
      return {
        response: config.off_hours_msg || "Estamos fora do horario de atendimento. Retornaremos em breve!",
      };
    }
  }

  // 3. Get conversation history with TIME WINDOW
  const timeWindowCutoff = new Date(
    Date.now() - (config.context_time_window_hours || 24) * 60 * 60 * 1000
  ).toISOString();

  const { data: messages } = await supabase
    .from("messages")
    .select("sender, content, created_at")
    .eq("conversation_id", conversationId)
    .gte("created_at", timeWindowCutoff)
    .order("created_at", { ascending: false })
    .limit(config.context_max_messages || 30);

  // Reverse to chronological, ensure minimum context
  let history: ChatMessage[] = (messages || []).reverse().map(
    (msg: { sender: string; content: string | null }) => ({
      role: (msg.sender === "lead" ? "user" : "assistant") as "user" | "assistant",
      content: msg.content || "",
    })
  );

  // Ensure minimum messages
  if (history.length < (config.context_min_messages || 3)) {
    const { data: fallbackMsgs } = await supabase
      .from("messages")
      .select("sender, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(config.context_min_messages || 3);

    if (fallbackMsgs && fallbackMsgs.length > history.length) {
      history = fallbackMsgs.reverse().map(
        (msg: { sender: string; content: string | null }) => ({
          role: (msg.sender === "lead" ? "user" : "assistant") as "user" | "assistant",
          content: msg.content || "",
        })
      );
    }
  }

  // Handle media messages
  if (media) {
    // Audio: acknowledge that we cannot listen
    if (media.type === "audio") {
      return {
        response: "Recebi seu audio. Infelizmente ainda nao consigo ouvir audios, mas posso ajudar por texto!",
      };
    }

    // Video: ask to describe via text
    if (media.type === "video") {
      return {
        response: "Recebi seu video! Poderia descrever o que precisa por texto?",
      };
    }

    // Document: ask what it's about
    if (media.type === "document") {
      return {
        response: "Recebi seu documento. Poderia me explicar sobre o que se trata?",
      };
    }

    // Image: use GPT-4o vision to interpret
    if (media.type === "image") {
      history.push({
        role: "user",
        content: [
          { type: "text", text: leadMessage || "O cliente enviou esta imagem:" },
          { type: "image_url", image_url: { url: media.url } },
        ],
      });
    } else {
      // Fallback for unknown media types
      history.push({ role: "user" as const, content: leadMessage || "O cliente enviou uma midia." });
    }
  } else {
    // Add new text message
    history.push({ role: "user" as const, content: leadMessage });
  }

  // 4. Build system prompt
  const toneMap: Record<string, string> = {
    formal: "Use linguagem formal e profissional. Trate o cliente por senhor(a).",
    amigavel: "Use linguagem amigavel e acolhedora. Seja proximo mas profissional.",
    casual: "Use linguagem casual e descontraida. Use emojis moderadamente.",
  };

  const toneInstruction = toneMap[config.tone] || toneMap["amigavel"];
  const maxLen = config.max_message_length || 500;

  const systemPrompt = `${config.prompt}

Instrucoes de tom: ${toneInstruction}

Regras:
- Responda em portugues brasileiro
- Seja conciso - maximo ${maxLen} caracteres por mensagem
- Se a resposta for longa, divida em paragrafos curtos
- Se nao souber responder algo especifico, ofereca encaminhar para um atendente humano
- Nunca invente informacoes que nao estao no seu prompt
- Colete informacoes do lead naturalmente durante a conversa
- NAO use markdown, asteriscos ou formatacao - apenas texto puro para WhatsApp`;

  // 5. Generate response
  const response = await chatCompletion(systemPrompt, history, {
    model: config.model || "gpt-4o-mini",
    temperature: (config.temperature || 70) / 100, // UAZAPI uses 0-100, OpenAI uses 0-1
    maxTokens: Math.ceil(maxLen * 1.5), // Allow a bit more for natural endings
    topP: config.top_p || 0.9,
    frequencyPenalty: (config.frequency_penalty || 30) / 100,
    presencePenalty: (config.presence_penalty || 10) / 100,
  });

  // 6. Post-process response
  let finalResponse = response.trim();

  // Sign message if enabled
  if (config.sign_messages && config.sign_name) {
    finalResponse = `${finalResponse}\n\n— ${config.sign_name}`;
  }

  // Split long messages
  let splitMessages: string[] | undefined;
  if (config.split_long_messages && finalResponse.length > maxLen) {
    splitMessages = splitMessage(finalResponse, maxLen);
  }

  // 7. Update token count
  const approxTokens = Math.ceil((systemPrompt.length + leadMessage.length + response.length) / 4);
  await supabase
    .from("ai_assistants")
    .update({
      total_tokens_used: (config.total_tokens_used || 0) + approxTokens,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assistantId);

  return {
    response: finalResponse,
    tokensUsed: approxTokens,
    splitMessages,
  };
}

/**
 * Splits a long message into chunks, breaking at natural points
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    // Find best split point: paragraph break > sentence end > space
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt < maxLength * 0.3) {
      splitAt = remaining.lastIndexOf(". ", maxLength);
      if (splitAt > 0) splitAt += 1; // include the period
    }
    if (splitAt < maxLength * 0.3) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      splitAt = maxLength; // force break
    }

    parts.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }

  return parts;
}

/**
 * Calculates typing delay proportional to message length (simulates human)
 */
export function calculateTypingDelay(text: string, baseDelay: number = 3): number {
  // ~200 chars per second reading speed, minimum baseDelay seconds
  const readingTime = text.length / 200;
  return Math.max(baseDelay, Math.min(readingTime + baseDelay, 15)); // cap at 15 seconds
}
