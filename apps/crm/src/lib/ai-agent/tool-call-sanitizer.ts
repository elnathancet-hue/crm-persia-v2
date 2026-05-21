// Bug D fix (mai/2026): a IA às vezes "alucina" e escreve o nome
// de uma tool call como texto literal no output — em vez de chamar
// via OpenAI function_call, ela escreve `emit_event("coletou_idade")`
// como se fosse uma frase. Esse texto vaza pro WhatsApp do lead em
// prod (capturado: contato "Elnathan NICOLAS" em mai/2026 viu a
// linha `emit_event("coletou_idade")` no chat dele).
//
// Causa: modelos mais novos (gpt-5*, gpt-4o*) às vezes retornam
// `tool_calls` E `content` no MESMO turno. A LLM "pensa em voz alta"
// no content sobre o que vai chamar, em vez de só chamar. Isso piora
// quando o system prompt menciona o nome da tool literalmente
// (`call emit_event with the matching handle when...`).
//
// Esta defesa é POST-PROCESSING: independente de o que a LLM gerar,
// stripamos qualquer ocorrência de `<known_tool>(<anything>)` do
// texto antes de enviar pro provider. Mantém a sanity do chat do
// lead enquanto o root cause (prompt engineering) é trabalhado.
//
// Lista de tools conhecidas no runtime do AI Agent v2 — espelho do
// que está em packages/shared/src/ai-agent/tool-presets.ts. Se uma
// tool nova entrar, ADICIONAR AQUI também (idealmente exportar do
// shared e importar, mas pra evitar dependência circular agora,
// duplicamos a lista — só nomes, não comportamento).

const KNOWN_TOOL_NAMES: ReadonlyArray<string> = [
  "emit_event",
  "add_tag",
  "remove_tag",
  "move_pipeline_stage",
  "set_lead_custom_field",
  "create_appointment",
  "reschedule_appointment",
  "cancel_appointment",
  "send_media",
  "trigger_notification",
  "stop_agent",
  "transfer_to_user",
  "transfer_to_agent",
  "round_robin_user",
  "send_whatsapp_message",
  "schedule_event",
  "lookup_lead_info",
];

// Pattern: `tool_name(...)` onde tool_name é um dos conhecidos.
// Aceita qualquer coisa entre os parênteses (incl. quebras de linha
// se a IA quebrar feio o output). `[^)]*` é greedy mas curto — pega
// até o primeiro `)`. Suficiente pros casos vistos em prod.
//
// Construído dinamicamente pra cobrir TODAS as tools listadas acima
// em UMA regex (mais barato que N regex separadas).
const LEAK_PATTERN = new RegExp(
  `\\b(?:${KNOWN_TOOL_NAMES.join("|")})\\s*\\([^)]*\\)`,
  "gi",
);

export interface SanitizeResult {
  cleaned: string;
  leakedPatterns: string[];
}

/**
 * Remove ocorrências de tool calls escritas como texto literal pelo
 * LLM. Retorna texto sanitizado + lista das ocorrências removidas
 * (pra logar em audit).
 *
 * Behavior:
 *  - Match case-insensitive (`Emit_Event(...)` também é stripado).
 *  - Remove o match inteiro (nome + parênteses + args).
 *  - Comprime espaços/quebras de linha vazias resultantes (texto
 *    fica legível mesmo após o strip).
 *  - Se a string FICAR vazia após strip, retorna string vazia
 *    (caller decide se quer enviar mensagem placeholder ou pular
 *    send_text).
 */
export function stripToolCallLeaks(text: string): SanitizeResult {
  const matches = text.match(LEAK_PATTERN);
  if (!matches || matches.length === 0) {
    return { cleaned: text, leakedPatterns: [] };
  }
  // Remove os matches.
  let cleaned = text.replace(LEAK_PATTERN, "");
  // Comprime: 3+ quebras de linha viram 2 (separação de parágrafo).
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  // Comprime: linha inteira vazia no início ou fim → trim.
  cleaned = cleaned.trim();
  return {
    cleaned,
    leakedPatterns: matches.map((m) => m.trim()),
  };
}
