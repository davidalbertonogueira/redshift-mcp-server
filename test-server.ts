import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';

// Create an MCP server
const server = new McpServer({
  name: 'demo-server',
  version: '1.0.0'
});

// Add an addition tool
server.registerTool(
  'add',
  {
    title: 'Addition Tool',
    description: 'Add two numbers',
    inputSchema: {
      a: z.number(),
      b: z.number()
    },
    outputSchema: {
      result: z.number()
    }
  },
  async ({ a, b }) => {
    const output = { result: a + b };
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    };
  }
);

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  // Create a new transport for each request to prevent request ID collisions
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  res.on('close', () => {
    transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || '3000');
app.listen(port, () => {
  console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
}).on('error', error => {
  console.error('Server error:', error);
  process.exit(1);
});
