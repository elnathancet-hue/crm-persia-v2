import { z } from "zod";
import {
  maskTargetAddress,
  NOTIFICATION_CUSTOM_KEYS_MAX,
  NOTIFICATION_CUSTOM_KEY_MAX_CHARS,
  NOTIFICATION_CUSTOM_VALUE_MAX_CHARS,
  type NativeHandler,
  type TriggerNotificationHandlerInput,
} from "@persia/shared/ai-agent";
import {
  buildNotificationFixedVariables,
  dispatchNotificationTemplate,
  loadNotificationLead,
  loadTemplateByName,
  normalizeNotificationTargetAddress,
} from "../notifications";
import {
  failureResult,
  getHandlerConfig,
  getHandlerDb,
  getHandlerProvider,
  successResult,
} from "./shared";

// OpenAI Responses strict-ready (mai/2026): `custom` agora chega do LLM
// como string JSON serializada (preset declara `type: "string", nullable: true`
// pra ficar compatível com Responses strict mode — objects arbitrários sem
// `additionalProperties: false` quebram strict). Aceita também o shape
// antigo `Record<string,string>` direto pra retrocompat com callers internos.
const triggerNotificationSchema = z.object({
  template_name: z.string().trim().min(1).max(120),
  custom: z
    .union([z.record(z.string(), z.string()), z.string(), z.null()])
    .optional()
    .transform((value): Record<string, string> | undefined => {
      if (value === null || value === undefined) return undefined;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const result: Record<string, string> = {};
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              result[k] = typeof v === "string" ? v : String(v);
            }
            return result;
          }
          return undefined;
        } catch {
          return undefined;
        }
      }
      return value as Record<string, string>;
    }),
}) satisfies z.ZodType<TriggerNotificationHandlerInput>;

export const triggerNotificationHandler: NativeHandler = async (
  context,
  input,
) => {
  const parsed = triggerNotificationSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const customValidationError = validateCustomVariables(parsed.data.custom);
  if (customValidationError) {
    return failureResult(customValidationError);
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const config = getHandlerConfig(context);
  if (!config) return failureResult("agent config missing");

  try {
    const template = await loadTemplateByName(
      db,
      context.organization_id,
      config.id,
      parsed.data.template_name,
    );

    if (!template) {
      return failureResult("notification template not found", {
        template_name: parsed.data.template_name,
      });
    }

    if (template.status !== "active") {
      return failureResult("notification template is archived", {
        template_id: template.id,
        template_name: template.name,
      });
    }

    // PR1 #6 (mai/2026): detecta target_address placeholder do seed
    // ("0000000000" — `apps/crm/src/actions/ai-agent/configs.ts:404`).
    // Acontece quando cliente nao configurou o destinatario antes de
    // testar. Antes deste check, trigger_notification falhava no provider
    // mas a auto-action JA tinha sido marcada como executada — queimando
    // o disparo. Agora devolvemos `placeholder_skip: true` pra que o
    // runtime de stage-actions NAO persista a execucao e re-tente na
    // proxima entrada do lead na etapa (cliente arruma + lead volta).
    if (isPlaceholderTargetAddress(template.target_address)) {
      return failureResult(
        "notification target address is a placeholder — configure o destinatário antes de disparar",
        {
          template_id: template.id,
          template_name: template.name,
          placeholder_skip: true,
        },
      );
    }

    const lead = await loadNotificationLead(
      db,
      context.organization_id,
      context.lead_id,
    );
    const fixed = buildNotificationFixedVariables({
      agentName: config.name,
      crmConversationId: context.crm_conversation_id,
      lead,
    });
    const targetAddressMasked = maskTargetAddress(
      template.target_type,
      normalizeNotificationTargetAddress(
        template.target_type,
        template.target_address,
      ),
    );

    let dispatch;
    try {
      dispatch = await dispatchNotificationTemplate({
        template,
        fixed,
        custom: parsed.data.custom,
        provider: getHandlerProvider(context),
        dryRun: context.dry_run,
      });
    } catch (error) {
      return failureResult(
        error instanceof Error ? error.message : "notification dispatch failed",
        {
          template_id: template.id,
          template_name: template.name,
          target_type: template.target_type,
          target_address_masked: targetAddressMasked,
        },
      );
    }

    return successResult(
      {
        template_id: template.id,
        template_name: template.name,
        target_type: dispatch.targetType,
        target_address_masked: targetAddressMasked,
        message_id: dispatch.messageId,
        rendered_body: context.dry_run ? dispatch.renderedBody : undefined,
        rendered_body_length: dispatch.renderedBody.length,
        custom_keys: Object.keys(parsed.data.custom ?? {}),
        dry_run: context.dry_run,
      },
      [
        context.dry_run
          ? `would send notification ${template.name} to ${targetAddressMasked}`
          : `sent notification ${template.name} to ${targetAddressMasked}`,
      ],
    );
  } catch (error) {
    return failureResult(
      error instanceof Error ? error.message : "notification dispatch failed",
    );
  }
};

// PR1 #6: target_address e considerado placeholder quando colapsa pra
// uma string so de zeros depois de remover nao-digitos. Casa o seed
// "0000000000" e tambem variacoes mascaradas tipo "00 0000-0000".
function isPlaceholderTargetAddress(targetAddress: string | null | undefined): boolean {
  if (!targetAddress) return false;
  const digits = targetAddress.replace(/\D/g, "");
  if (digits.length === 0) return false;
  return /^0+$/.test(digits);
}

function validateCustomVariables(
  custom: Record<string, string> | undefined,
): string | null {
  if (!custom) return null;

  const entries = Object.entries(custom);
  if (entries.length > NOTIFICATION_CUSTOM_KEYS_MAX) {
    return `custom supports at most ${NOTIFICATION_CUSTOM_KEYS_MAX} keys`;
  }

  for (const [key, value] of entries) {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      return "custom keys must be non-empty";
    }
    if (trimmedKey.length > NOTIFICATION_CUSTOM_KEY_MAX_CHARS) {
      return `custom key ${trimmedKey} exceeds ${NOTIFICATION_CUSTOM_KEY_MAX_CHARS} chars`;
    }
    if (value.length > NOTIFICATION_CUSTOM_VALUE_MAX_CHARS) {
      return `custom value for ${trimmedKey} exceeds ${NOTIFICATION_CUSTOM_VALUE_MAX_CHARS} chars`;
    }
  }

  return null;
}
