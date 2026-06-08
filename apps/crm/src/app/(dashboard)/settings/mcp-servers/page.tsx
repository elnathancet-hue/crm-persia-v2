import { McpServersClient } from "./mcp-servers-client";
import { listMcpServers } from "@/actions/mcp-servers";

export const metadata = { title: "Servidores MCP" };

export default async function McpServersPage() {
  const result = await listMcpServers();
  return (
    <McpServersClient
      initialServers={result.ok ? result.servers : []}
      initialError={result.ok ? null : result.error}
    />
  );
}
