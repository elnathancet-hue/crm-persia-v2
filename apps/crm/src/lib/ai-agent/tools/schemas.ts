import type { JSONSchemaObject } from "@persia/shared/ai-agent";

export const stopAgentInputSchema: JSONSchemaObject = {
  type: "object",
  properties: {
    reason: {
      type: "string",
      description: "Optional short reason for handing the conversation to a human.",
    },
  },
  additionalProperties: false,
};
