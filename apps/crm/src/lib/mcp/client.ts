// MCP — Model Context Protocol client (HTTP transport).
//
// PR-FLOW-PIVOT PR 15 (mai/2026): cliente JSON-RPC 2.0 sobre HTTP pra
// comunicar com servidores MCP externos. Cobre o subset necessário pra
// V1:
//   - tools/list (discovery)
//   - tools/call (execution)
//
// Spec: https://spec.modelcontextprotocol.io/
//
// V1 NÃO suporta:
//   - SSE streaming (server-sent events) — adiciona complexidade de
//     conexão persistente; HTTP request/response basta pra MVP
//   - resources/prompts (recursos diferentes de tools)
//   - notifications (push do servidor pro cliente)
//   - initialize handshake — assumimos servidor segue protocolo,
//     pulamos direto pra tools/list. Se servidor exigir initialize
//     (raro em V1), erro vai aparecer claro no UI

const PROTOCOL_VERSION = "2024-11-05";

// ============================================================================
// Types
// ============================================================================

export interface McpServerConfig {
  server_url: string;
  auth_type: "none" | "bearer";
  auth_token: string | null;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  /** Conteúdo retornado pelo tool — sempre array per spec. V1 lê só o
   * primeiro item text. */
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: unknown }
  >;
  isError?: boolean;
}

// ============================================================================
// JSON-RPC plumbing
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

let requestIdCounter = 0;
function nextRequestId(): number {
  requestIdCounter = (requestIdCounter + 1) % Number.MAX_SAFE_INTEGER;
  return requestIdCounter;
}

async function rpcCall<T>(
  config: McpServerConfig,
  method: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const payload: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: nextRequestId(),
    method,
    ...(params ? { params } : {}),
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.auth_type === "bearer" && config.auth_token) {
    headers["Authorization"] = `Bearer ${config.auth_token}`;
  }

  let res: Response;
  try {
    res = await fetch(config.server_url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    throw new Error(
      `MCP request to ${config.server_url} falhou: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `MCP server retornou HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }

  let body: JsonRpcResponse<T>;
  try {
    body = (await res.json()) as JsonRpcResponse<T>;
  } catch {
    throw new Error("MCP server retornou body não-JSON");
  }

  if (body.error) {
    throw new Error(
      `MCP server erro RPC: ${body.error.code} ${body.error.message}`,
    );
  }
  if (body.result === undefined) {
    throw new Error("MCP server resposta sem result nem error");
  }
  return body.result;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Lista tools expostas pelo servidor MCP. Retorna shape compacto pra
 * armazenar em `mcp_server_connections.cached_tools`.
 */
export async function discoverTools(
  config: McpServerConfig,
  options?: { timeoutMs?: number },
): Promise<McpToolDefinition[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), options?.timeoutMs ?? 15000);
  try {
    const result = await rpcCall<{ tools?: unknown[] }>(
      config,
      "tools/list",
      {},
      ctrl.signal,
    );
    const tools = Array.isArray(result.tools) ? result.tools : [];
    return tools
      .filter(
        (t): t is { name: unknown; description?: unknown; inputSchema?: unknown } =>
          t !== null && typeof t === "object",
      )
      .map((t) => {
        const name = typeof t.name === "string" ? t.name : "";
        const description =
          typeof t.description === "string" ? t.description : undefined;
        const inputSchema =
          t.inputSchema && typeof t.inputSchema === "object"
            ? (t.inputSchema as Record<string, unknown>)
            : { type: "object", properties: {} };
        return { name, description, inputSchema };
      })
      .filter((t) => t.name.length > 0);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Invoca uma tool no servidor MCP. Retorna result normalizado.
 */
export async function callTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<McpToolCallResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), options?.timeoutMs ?? 30000);
  try {
    const result = await rpcCall<{
      content?: unknown;
      isError?: boolean;
    }>(
      config,
      "tools/call",
      {
        name: toolName,
        arguments: args,
      },
      ctrl.signal,
    );
    const content = Array.isArray(result.content) ? result.content : [];
    return {
      content: content as McpToolCallResult["content"],
      isError: Boolean(result.isError),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Helper pra extrair texto do result. Usado pra montar o payload de
 * volta pro LLM via tool_result message.
 */
export function extractTextFromResult(result: McpToolCallResult): string {
  const texts: string[] = [];
  for (const item of result.content) {
    if (item.type === "text") {
      texts.push(item.text);
    }
  }
  return texts.join("\n");
}

/**
 * Versão tipada do protocol version (exposto pra futura validação).
 */
export const MCP_PROTOCOL_VERSION = PROTOCOL_VERSION;
