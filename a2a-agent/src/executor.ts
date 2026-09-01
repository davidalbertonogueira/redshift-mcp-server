import { randomUUID } from "node:crypto";
import type { AgentExecutor, ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import { runClaude, type RunClaudeOptions } from "./claude-runner.js";

function extractText(message: Message): string {
  const textPart = message.parts.find((part) => part.kind === "text");
  return textPart && textPart.kind === "text" ? textPart.text : "";
}

function statusMessage(taskId: string, contextId: string, text: string): Message {
  return {
    kind: "message",
    messageId: randomUUID(),
    role: "agent",
    parts: [{ kind: "text", text }],
    taskId,
    contextId,
  };
}

export class RedshiftAgentExecutor implements AgentExecutor {
  constructor(private readonly runClaudeOptions: RunClaudeOptions = {}) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId, userMessage } = requestContext;
    const taskText = extractText(userMessage);

    const task: Task = {
      kind: "task",
      id: taskId,
      contextId,
      status: { state: "submitted", timestamp: new Date().toISOString() },
      history: [userMessage],
    };
    eventBus.publish(task);

    const working: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      final: false,
      status: { state: "working", timestamp: new Date().toISOString() },
    };
    eventBus.publish(working);

    const result = await runClaude(taskText, this.runClaudeOptions);

    const final: TaskStatusUpdateEvent =
      "error" in result
        ? {
            kind: "status-update",
            taskId,
            contextId,
            final: true,
            status: {
              state: "failed",
              message: statusMessage(taskId, contextId, result.error),
              timestamp: new Date().toISOString(),
            },
          }
        : {
            kind: "status-update",
            taskId,
            contextId,
            final: true,
            status: {
              state: "completed",
              message: statusMessage(taskId, contextId, result.text),
              timestamp: new Date().toISOString(),
            },
          };
    eventBus.publish(final);
  }

  // Single-shot execFile per task — nothing to resume or interrupt for v1.
  async cancelTask(): Promise<void> {}
}
