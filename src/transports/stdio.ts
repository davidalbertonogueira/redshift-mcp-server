import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * Run MCP server with STDIO transport.
 * Used for command-line clients like Claude Desktop, Cursor, Windsurf.
 */
export async function runStdioTransport(server: Server): Promise<void> {
  console.error("MCP Server running in STDIO mode");
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error("STDIO transport connected successfully");
}
