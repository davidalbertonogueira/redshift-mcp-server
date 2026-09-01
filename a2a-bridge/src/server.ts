import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ClientFactory } from "@a2a-js/sdk/client";
import type { Message, MessageSendParams, Task, TextPart } from "@a2a-js/sdk";

export const TOOL_NAME = "ask_redshift_agent";

const askSchema = z.object({
  question: z.string().describe("Natural-language question about the Redshift data warehouse"),
});

/** Minimal shape of an A2A client this bridge needs — real one is @a2a-js/sdk's Client. */
export interface A2AClientLike {
  sendMessage(params: MessageSendParams): Promise<Message | Task>;
}

export type CreateClient = (agentUrl: string) => Promise<A2AClientLike>;

const defaultCreateClient: CreateClient = (agentUrl) => new ClientFactory().createFromUrl(agentUrl);

/** Reduces an A2A message/send result (a completed Message, or a Task carrying its final status message) to plain text. */
export function extractText(result: Message | Task): string {
  const message = result.kind === "message" ? result : result.status.message;
  if (!message) return "";
  return message.parts
    .filter((part): part is TextPart => part.kind === "text")
    .map((part) => part.text)
    .join("\n");
}

export async function handleListTools() {
  return {
    tools: [
      {
        name: TOOL_NAME,
        description: "Ask the Redshift A2A agent a natural-language question about the data warehouse.",
        inputSchema: zodToJsonSchema(askSchema),
      },
    ],
  };
}

export async function handleCallTool(
  request: CallToolRequest,
  agentUrl: string,
  createClient: CreateClient = defaultCreateClient
): Promise<CallToolResult> {
  if (request.params.name !== TOOL_NAME) {
    return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
  }

  const question = request.params.arguments?.question as string;

  try {
    const client = await createClient(agentUrl);
    const result = await client.sendMessage({
      message: {
        kind: "message",
        messageId: randomUUID(),
        role: "user",
        parts: [{ kind: "text", text: question }],
      },
    });
    return { content: [{ type: "text", text: extractText(result) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error calling redshift agent: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

export function createBridgeServer(agentUrl: string, createClient: CreateClient = defaultCreateClient): Server {
  const server = new Server(
    { name: "redshift-a2a-bridge", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, handleListTools);
  server.setRequestHandler(CallToolRequestSchema, (request) => handleCallTool(request, agentUrl, createClient));

  return server;
}
