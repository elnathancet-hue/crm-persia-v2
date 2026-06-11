// Bug B fix (mai/2026): adicionado "messages_update" pra receber
// callbacks de ack (sent/delivered/read). Antes só inscrevia em
// "messages" (novas mensagens entrando) — confirmações de entrega
// nunca chegavam, então UI mostrava só 1 check ad eternum.
//
// Bug B.2 fix (mai/2026): removido "wasSentByApi" do excludeMessages.
// UAZAPI aplica esse filtro a TODOS os eventos, incluindo messages_update.
// Como ACKs (delivery/read) são exatamente das msgs que enviamos via API
// (wasSentByApi=true), o filtro suprimia todos os ACKs antes de chegar.
// Sem o filtro, events de messages com fromMe=true chegam mas são descartados
// pelo parseWebhook() (retorna null para fromMe=true) — sem risco de loop.
//
// Bug C fix (mai/2026): adicionado "groups" para receber eventos de
// participante entrou/saiu de grupos WhatsApp. Sem esse evento, leads
// nunca eram registrados ao entrar pelo link de convite do grupo.
//
// IMPORTANTE: instâncias existentes JÁ conectadas precisam ter o
// webhook reconfigurado (re-chamar provider.setWebhook). Sem isso,
// as mudanças não são entregues. Ver script `scripts/uazapi-resync-webhooks.ts`.
export const UAZAPI_DEFAULT_WEBHOOK_EVENTS = [
  "messages",
  "messages_update",
  "groups",
] as const;
export const UAZAPI_DEFAULT_EXCLUDED_MESSAGES = [] as const;

export type UazapiWebhookEvent = (typeof UAZAPI_DEFAULT_WEBHOOK_EVENTS)[number] | "connection";
// Known filter values; kept as string for forward-compat with future UAZAPI values.
export type UazapiWebhookExcludedMessage = "wasSentByApi" | "wasNotSentByApi" | "fromMeYes" | "fromMeNo" | "isGroupYes" | "isGroupNo" | string;

export interface UazapiWebhookConfig {
  enabled: boolean;
  url: string;
  events: UazapiWebhookEvent[];
  excludeMessages?: UazapiWebhookExcludedMessage[];
}

export interface BuildUazapiWebhookConfigOptions {
  url: string;
  events?: UazapiWebhookEvent[];
  excludeMessages?: UazapiWebhookExcludedMessage[];
  enabled?: boolean;
}

export function buildUazapiWebhookConfig(options: BuildUazapiWebhookConfigOptions): UazapiWebhookConfig {
  const events = options.events ?? [...UAZAPI_DEFAULT_WEBHOOK_EVENTS];
  const excludeMessages = options.excludeMessages ?? [...UAZAPI_DEFAULT_EXCLUDED_MESSAGES];

  return {
    enabled: options.enabled ?? true,
    url: options.url,
    events,
    ...(excludeMessages.length > 0 ? { excludeMessages } : {}),
  };
}

export interface ConfigureUazapiWebhookOptions extends BuildUazapiWebhookConfigOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export async function configureUazapiWebhook(options: ConfigureUazapiWebhookOptions): Promise<Response> {
  const { validateProviderUrl } = await import("./uazapi-client");
  const fetcher = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  validateProviderUrl(baseUrl);

  const res = await fetcher(`${baseUrl}/webhook`, {
    method: "POST",
    headers: {
      token: options.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildUazapiWebhookConfig(options)),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Falha ao configurar webhook UAZAPI: HTTP ${res.status}`);
  }

  return res;
}
