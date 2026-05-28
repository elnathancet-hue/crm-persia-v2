import type { JSONSchemaObject, JSONSchemaProperty } from "@persia/shared/ai-agent";

export type OpenAIStrictSchemaIssueSeverity = "error" | "warning";

export interface OpenAIStrictSchemaIssue {
  path: string;
  severity: OpenAIStrictSchemaIssueSeverity;
  message: string;
}

export interface OpenAIStrictSchemaAuditResult {
  compatibleWithStrict: boolean;
  issues: OpenAIStrictSchemaIssue[];
}

const ALLOWED_STRING_FORMATS = new Set(["uuid", "email", "uri", "date-time"]);

type AuditableObjectSchema = {
  type: "object";
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
};

export function auditOpenAIStrictToolSchema(
  schema: JSONSchemaObject,
): OpenAIStrictSchemaAuditResult {
  const issues: OpenAIStrictSchemaIssue[] = [];
  auditObjectSchema(schema, "$", issues);
  return {
    compatibleWithStrict: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}

function auditObjectSchema(
  schema: AuditableObjectSchema,
  path: string,
  issues: OpenAIStrictSchemaIssue[],
) {
  if (schema.type !== "object") {
    issues.push({
      path,
      severity: "error",
      message: "Root schema must be an object.",
    });
    return;
  }

  if (schema.additionalProperties !== false) {
    issues.push({
      path,
      severity: "error",
      message: "Strict function schemas must set additionalProperties: false.",
    });
  }

  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  for (const key of Object.keys(properties)) {
    if (!required.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        severity: "error",
        message:
          "Strict function schemas must require every declared property. Model optional fields as nullable before enabling strict.",
      });
    }
  }

  for (const requiredKey of required) {
    if (!Object.prototype.hasOwnProperty.call(properties, requiredKey)) {
      issues.push({
        path: `${path}.${requiredKey}`,
        severity: "error",
        message: "Required field is not declared in properties.",
      });
    }
  }

  for (const [key, property] of Object.entries(properties)) {
    auditProperty(property, `${path}.${key}`, issues);
  }
}

function auditProperty(
  property: JSONSchemaProperty,
  path: string,
  issues: OpenAIStrictSchemaIssue[],
) {
  switch (property.type) {
    case "string":
      if (property.format && !ALLOWED_STRING_FORMATS.has(property.format)) {
        issues.push({
          path,
          severity: "warning",
          message: `String format "${property.format}" is not in the known allowlist.`,
        });
      }
      return;
    case "number":
    case "integer":
    case "boolean":
      return;
    case "array":
      auditProperty(property.items, `${path}[]`, issues);
      return;
    case "object":
      auditObjectSchema(
        {
          type: "object",
          properties: property.properties ?? {},
          required: property.required,
          additionalProperties: false,
        },
        path,
        issues,
      );
      return;
  }
}
