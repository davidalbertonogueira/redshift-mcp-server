#!/usr/bin/env node
/**
 * MCP Server Testing Utility
 * 
 * This file contains test commands for the Redshift MCP server.
 * Use this to verify that your server is working correctly.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

console.error("=== MCP Server Test Utility ===");

const server = new Server(
  {
    name: "test-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: { list: {}, call: {} },
    },
  }
);

// Simple test tool
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("✅ ListTools handler called successfully!");
  return {
    tools: [
      {
        name: "test",
        description: "A simple test tool",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
        },
      },
    ],
  };
});

// Run the server
async function runServer() {
  const transport = new StdioServerTransport();
  console.error("🚀 Test server starting...");
  await server.connect(transport);
  console.error("✅ Test server ready!");
}

runServer().catch((error) => {
  console.error("❌ Server error:", error);
  process.exit(1);
});
