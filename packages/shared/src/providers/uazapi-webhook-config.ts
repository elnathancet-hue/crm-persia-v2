export const UAZAPI_DEFAULT_WEBHOOK_EVENTS = ["messages"] as const;
export const UAZAPI_DEFAULT_EXCLUDED_MESSAGES = ["wasSentByApi"] as const;

export type UazapiWebhookEvent = (typeof UAZAPI_DEFAULT_WEBHOOK_EVENTS)[number] | "connection";
export type UazapiWebhookExcludedMessage = (typeof UAZAPI_DEFAULT_EXCLUDED_MESSAGES)[number];

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
  const fetcher = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  return fetcher(`${baseUrl}/webhook`, {
    method: "POST",
    headers: {
      token: options.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildUazapiWebhookConfig(options)),
  });
}
