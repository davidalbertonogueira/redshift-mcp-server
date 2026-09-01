#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBridgeServer } from "./server.js";

async function main() {
  const agentUrl = process.env.REDSHIFT_AGENT_URL ?? "http://localhost:4000";
  const server = createBridgeServer(agentUrl);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
