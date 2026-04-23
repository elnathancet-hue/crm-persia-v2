import type {
  AgentTool,
  NativeHandlerName,
  NativeHandlerRegistry,
} from "@persia/shared/ai-agent";
import { stopAgentHandler } from "./stop-agent";
import { stopAgentInputSchema } from "./schemas";

export const nativeHandlers: NativeHandlerRegistry = {
  stop_agent: stopAgentHandler,
};

export function isImplementedNativeHandler(
  handler: NativeHandlerName | null,
): handler is keyof typeof nativeHandlers {
  return !!handler && handler in nativeHandlers;
}

export function getDefaultStopAgentTool(params: {
  configId: string;
  organizationId: string;
}): Omit<AgentTool, "id" | "created_at" | "updated_at"> {
  return {
    config_id: params.configId,
    organization_id: params.organizationId,
    name: "stop_agent",
    description:
      "Pause the native agent for this conversation and hand the next reply to a human.",
    input_schema: stopAgentInputSchema,
    execution_mode: "native",
    native_handler: "stop_agent",
    webhook_url: null,
    webhook_secret: null,
    is_enabled: true,
  };
}
