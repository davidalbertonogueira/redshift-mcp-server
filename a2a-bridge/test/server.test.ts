import { describe, expect, it } from "vitest";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Message, Task } from "@a2a-js/sdk";
import { TOOL_NAME, extractText, handleCallTool, handleListTools } from "../src/server.js";

function callRequest(args: Record<string, unknown>): CallToolRequest {
  return { method: "tools/call", params: { name: TOOL_NAME, arguments: args } };
}

describe("handleListTools", () => {
  it("registers exactly one tool with a question:string input schema", async () => {
    const { tools } = await handleListTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe(TOOL_NAME);
    expect(tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    });
  });
});

describe("extractText", () => {
  it("reduces a Message result to its text parts", () => {
    const message: Message = {
      kind: "message",
      messageId: "m1",
      role: "agent",
      parts: [{ kind: "text", text: "5" }],
    };
    expect(extractText(message)).toBe("5");
  });

  it("reduces a Task result to its final status message's text parts", () => {
    const task: Task = {
      kind: "task",
      id: "t1",
      contextId: "c1",
      status: {
        state: "completed",
        message: {
          kind: "message",
          messageId: "m2",
          role: "agent",
          parts: [{ kind: "text", text: "5 completed orders" }],
        },
      },
    };
    expect(extractText(task)).toBe("5 completed orders");
  });

  it("returns an empty string for a Task with no status message", () => {
    const task: Task = { kind: "task", id: "t1", contextId: "c1", status: { state: "working" } };
    expect(extractText(task)).toBe("");
  });
});

describe("handleCallTool", () => {
  it("returns an error for an unknown tool name", async () => {
    const request: CallToolRequest = { method: "tools/call", params: { name: "not_this_tool", arguments: {} } };
    const result = await handleCallTool(request, "http://localhost:4000");
    expect(result.isError).toBe(true);
  });

  it("sends the question to the A2A agent and returns its text answer (Message result)", async () => {
    const sendMessage = async () =>
      ({ kind: "message", messageId: "m1", role: "agent", parts: [{ kind: "text", text: "5" }] }) as Message;
    const request = callRequest({ question: "how many completed orders?" });

    const result = await handleCallTool(request, "http://localhost:4000", async () => ({ sendMessage }));

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "5" }]);
  });

  it("sends the question to the A2A agent and returns its text answer (Task result)", async () => {
    const sendMessage = async () =>
      ({
        kind: "task",
        id: "t1",
        contextId: "c1",
        status: {
          state: "completed",
          message: { kind: "message", messageId: "m2", role: "agent", parts: [{ kind: "text", text: "5" }] },
        },
      }) as Task;
    const request = callRequest({ question: "how many completed orders?" });

    const result = await handleCallTool(request, "http://localhost:4000", async () => ({ sendMessage }));

    expect(result.content).toEqual([{ type: "text", text: "5" }]);
  });

  it("returns isError:true instead of throwing when the A2A call fails", async () => {
    const request = callRequest({ question: "anything" });

    const result = await handleCallTool(request, "http://localhost:4000", async () => ({
      sendMessage: async () => {
        throw new Error("agent unreachable");
      },
    }));

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Error calling redshift agent: agent unreachable" }]);
  });

  it("returns isError:true when the client itself fails to connect", async () => {
    const request = callRequest({ question: "anything" });

    const result = await handleCallTool(request, "http://localhost:4000", async () => {
      throw new Error("could not fetch agent card");
    });

    expect(result.isError).toBe(true);
  });
});
