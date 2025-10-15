#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "minimal-test-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: { list: {}, call: {} },
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("ListTools handler called!");
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

// Run the server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);
