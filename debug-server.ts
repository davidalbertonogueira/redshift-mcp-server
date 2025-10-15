#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

console.error("Starting server...");

const server = new Server(
  {
    name: "debug-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

console.error("Server created, setting up handlers...");

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  console.error("ListTools handler called with request:", JSON.stringify(request));
  return {
    tools: [
      {
        name: "test",
        description: "A test tool",
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

console.error("Handler set, starting transport...");

// Run the server
async function runServer() {
  const transport = new StdioServerTransport();
  console.error("Transport created, connecting...");
  await server.connect(transport);
  console.error("Server connected and ready!");
}

runServer().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
