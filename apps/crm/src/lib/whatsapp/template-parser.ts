/**
 * Template parser — derives a `ParamsSchema` from a Meta template's components.
 *
 * Based on the whatsapp-cloud-inbox reference. Adapts it to our storage shape
 * (keeping raw `components` in the DB + this derived schema to drive the UI).
 *
 * Meta supports two parameter notations:
 *   - POSITIONAL: {{1}} {{2}} ... — params are inferred by order
 *   - NAMED:      {{nome}} {{produto}} ... — params have names; detected when
 *     example.body_text_named_params / example.header_text_named_params exists
 *
 * After sync we keep the `params_schema` on wa_templates so the UI renders the
 * variable form without re-parsing per open, and the outgoing send uses it to
 * build the Graph API `components` payload.
 */

// ============ public types ============

export type ParamFormat = "POSITIONAL" | "NAMED" | "NONE";

export interface ParamSpec {
  /** Positional index (1-based) when format === "POSITIONAL". */
  index?: number;
  /** Parameter name when format === "NAMED". */
  name?: string;
  /** Example value provided by Meta, used as placeholder in the UI. */
  example?: string;
}

export interface HeaderSchema {
  format: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  params: ParamSpec[];
}

export interface ButtonSchema {
  index: number;                                      // 0-based index in the BUTTONS component
  subType: "URL" | "QUICK_REPLY" | "PHONE_NUMBER" | "COPY_CODE" | "OTP";
  text: string;                                       // button label (always)
  params: ParamSpec[];                                // only URL/OTP typically have dynamic params
}

export interface ParamsSchema {
  format: ParamFormat;
  header?: HeaderSchema;
  body?: { params: ParamSpec[] };
  buttons?: ButtonSchema[];
}

// ============ Meta component shapes (narrow for what we read) ============

export interface MetaComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  text?: string;
  buttons?: MetaButton[];
  example?: {
    header_text?: string[];
    header_handle?: string[];
    body_text?: string[][];
    header_text_named_params?: Array<{ param_name: string; example: string }>;
    body_text_named_params?: Array<{ param_name: string; example: string }>;
  };
}

export interface MetaButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP";
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

// ============ public API ============

/** Derive `ParamsSchema` from the raw components Meta returns. */
export function parseTemplateParams(components: MetaComponent[]): ParamsSchema {
  const body = components.find((c) => c.type === "BODY");
  const header = components.find((c) => c.type === "HEADER");
  const buttonsComp = components.find((c) => c.type === "BUTTONS");

  // Detect format from BODY (the most common carrier). NAMED example takes
  // priority over POSITIONAL; if neither has params, format is NONE.
  const format: ParamFormat = body?.example?.body_text_named_params
    ? "NAMED"
    : header?.example?.header_text_named_params
      ? "NAMED"
      : hasPositionalParams(body?.text) || hasPositionalParams(header?.text)
        ? "POSITIONAL"
        : "NONE";

  const schema: ParamsSchema = { format };

  if (header) {
    schema.header = parseHeader(header, format);
    if (schema.header.params.length === 0 && (header.format === "IMAGE" || header.format === "VIDEO" || header.format === "DOCUMENT")) {
      // Media headers always need a single "media" param even when Meta omits example.
      schema.header.params = [{ example: undefined }];
    }
  }

  if (body) {
    schema.body = { params: parseTextParams(body, "body", format) };
  }

  if (buttonsComp?.buttons) {
    schema.buttons = buttonsComp.buttons.map((btn, index) => parseButton(btn, index));
  }

  return schema;
}

/**
 * Build Graph API `components[]` payload from user-provided variable values.
 *
 * `values` shape depends on `schema.format`:
 *   - POSITIONAL: { header?: string[], body?: string[], buttons?: Record<index, string[]> }
 *   - NAMED:      { header?: Record<name, string>, body?: Record<name, string>, buttons?: Record<index, string[]> }
 *
 * For media headers (IMAGE/VIDEO/DOCUMENT), the single param is a media_id OR
 * a public URL — see `resolveMediaRef` in MetaCloudAdapter if you have base64.
 */
export interface TemplateVariableValues {
  header?: string[] | Record<string, string>;
  body?: string[] | Record<string, string>;
  buttons?: Record<number, string[]>;
}

export function buildTemplateComponents(
  schema: ParamsSchema,
  values: TemplateVariableValues,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  if (schema.header && schema.header.params.length > 0) {
    const parameters = buildHeaderParameters(schema.header, values.header ?? []);
    if (parameters.length > 0) out.push({ type: "header", parameters });
  }

  if (schema.body && schema.body.params.length > 0) {
    const parameters = buildBodyParameters(schema.body.params, values.body ?? [], schema.format);
    if (parameters.length > 0) out.push({ type: "body", parameters });
  }

  if (schema.buttons) {
    for (const btn of schema.buttons) {
      if (btn.params.length === 0) continue;
      const vals = values.buttons?.[btn.index] ?? [];
      const parameters = btn.params.map((_, i) => ({
        type: btn.subType === "URL" ? "text" : "payload",
        text: vals[i] ?? "",
      }));
      out.push({
        type: "button",
        sub_type: btn.subType === "URL" ? "url" : "quick_reply",
        index: String(btn.index),
        parameters,
      });
    }
  }

  return out;
}

// ============ internals ============

function hasPositionalParams(text: string | undefined): boolean {
  if (!text) return false;
  return /\{\{\d+\}\}/.test(text);
}

function parseHeader(comp: MetaComponent, format: ParamFormat): HeaderSchema {
  const headerFormat = (comp.format ?? "TEXT") as HeaderSchema["format"];

  if (headerFormat !== "TEXT") {
    // Media headers: a single param representing the media reference.
    return { format: headerFormat, params: [{ example: undefined }] };
  }

  return {
    format: "TEXT",
    params: parseTextParams(comp, "header", format),
  };
}

function parseTextParams(comp: MetaComponent, kind: "header" | "body", format: ParamFormat): ParamSpec[] {
  if (!comp.text) return [];

  if (format === "NAMED") {
    const namedKey = kind === "header" ? "header_text_named_params" : "body_text_named_params";
    const named = comp.example?.[namedKey] as Array<{ param_name: string; example: string }> | undefined;
    return (named ?? []).map((p) => ({ name: p.param_name, example: p.example }));
  }

  // POSITIONAL: extract unique {{N}} tokens from text, preserve numeric order.
  const matches = Array.from(comp.text.matchAll(/\{\{(\d+)\}\}/g));
  const indexes = Array.from(new Set(matches.map((m) => Number(m[1]))))
    .sort((a, b) => a - b);

  // Examples arrive as string[] for header, string[][] for body (first row).
  let examples: string[] = [];
  if (kind === "header" && comp.example?.header_text) {
    examples = comp.example.header_text;
  } else if (kind === "body" && comp.example?.body_text) {
    examples = comp.example.body_text[0] ?? [];
  }

  return indexes.map((idx, i) => ({ index: idx, example: examples[i] }));
}

function parseButton(btn: MetaButton, index: number): ButtonSchema {
  // Only URL and OTP buttons have dynamic params. QUICK_REPLY / PHONE_NUMBER /
  // COPY_CODE are static text-only buttons.
  if (btn.type === "URL" && btn.url && btn.url.includes("{{")) {
    const matches = Array.from(btn.url.matchAll(/\{\{(\d+)\}\}/g));
    const indexes = Array.from(new Set(matches.map((m) => Number(m[1]))))
      .sort((a, b) => a - b);
    const examples = btn.example ?? [];
    return {
      index,
      subType: "URL",
      text: btn.text,
      params: indexes.map((idx, i) => ({ index: idx, example: examples[i] })),
    };
  }

  if (btn.type === "OTP") {
    return {
      index,
      subType: "OTP",
      text: btn.text,
      params: [{ example: btn.example?.[0] }],
    };
  }

  return {
    index,
    subType: btn.type,
    text: btn.text,
    params: [],
  };
}

function buildHeaderParameters(header: HeaderSchema, values: string[] | Record<string, string>): Array<Record<string, unknown>> {
  if (header.format === "TEXT") {
    return header.params.map((p) =>
      p.name
        ? { type: "text", parameter_name: p.name, text: (values as Record<string, string>)[p.name] ?? "" }
        : { type: "text", text: (values as string[])[(p.index ?? 1) - 1] ?? "" },
    );
  }

  // Media header — single param carrying either { id } (media_id) or { link } (URL).
  const single = Array.isArray(values) ? values[0] : Object.values(values)[0];
  const ref = single?.startsWith("http") ? { link: single } : { id: single };
  const key = header.format.toLowerCase(); // image | video | document
  return [{ type: key, [key]: ref }];
}

function buildBodyParameters(
  params: ParamSpec[],
  values: string[] | Record<string, string>,
  format: ParamFormat,
): Array<Record<string, unknown>> {
  if (format === "NAMED") {
    return params.map((p) => ({
      type: "text",
      parameter_name: p.name ?? "",
      text: (values as Record<string, string>)[p.name ?? ""] ?? "",
    }));
  }
  return params.map((p, i) => ({
    type: "text",
    text: (values as string[])[i] ?? "",
  }));
}
