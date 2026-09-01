import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import type { AgentExecutionEvent, Message, TaskStatusUpdateEvent } from "@a2a-js/sdk";

// vi.mock's factory is hoisted above this file's other top-level statements,
// so the mock fn must be created via vi.hoisted() to survive that reordering.
const runClaudeMock = vi.hoisted(() => vi.fn());
vi.mock("../src/claude-runner.js", () => ({ runClaude: runClaudeMock }));

// vitest hoists vi.mock calls above imports in this file, so this import
// already resolves against the mocked claude-runner module.
import { RedshiftAgentExecutor } from "../src/executor.js";

class FakeEventBus implements ExecutionEventBus {
  events: AgentExecutionEvent[] = [];
  publish(event: AgentExecutionEvent): void {
    this.events.push(event);
  }
  on() {
    return this;
  }
  off() {
    return this;
  }
  once() {
    return this;
  }
  removeAllListeners() {
    return this;
  }
  finished() {}
}

function fakeContext(text: string): RequestContext {
  const userMessage: Message = {
    kind: "message",
    messageId: "msg-1",
    role: "user",
    parts: [{ kind: "text", text }],
  };
  return { userMessage, taskId: "task-1", contextId: "ctx-1" } as RequestContext;
}

beforeEach(() => {
  runClaudeMock.mockReset();
});

describe("RedshiftAgentExecutor", () => {
  it("publishes submitted -> working -> completed on success", async () => {
    runClaudeMock.mockResolvedValue({ text: "5" });
    const bus = new FakeEventBus();
    const executor = new RedshiftAgentExecutor();

    await executor.execute(fakeContext("how many completed orders?"), bus);

    expect(bus.events).toHaveLength(3);
    expect(bus.events[0]).toMatchObject({ kind: "task", status: { state: "submitted" } });
    expect(bus.events[1]).toMatchObject({ kind: "status-update", status: { state: "working" }, final: false });

    const final = bus.events[2] as TaskStatusUpdateEvent;
    expect(final.kind).toBe("status-update");
    expect(final.final).toBe(true);
    expect(final.status.state).toBe("completed");
    expect(final.status.message?.parts).toEqual([{ kind: "text", text: "5" }]);

    expect(runClaudeMock).toHaveBeenCalledWith("how many completed orders?", {});
  });

  it("publishes submitted -> working -> failed when runClaude errors", async () => {
    runClaudeMock.mockResolvedValue({ error: "claude timed out" });
    const bus = new FakeEventBus();
    const executor = new RedshiftAgentExecutor();

    await executor.execute(fakeContext("anything"), bus);

    const final = bus.events[2] as TaskStatusUpdateEvent;
    expect(final.status.state).toBe("failed");
    expect(final.status.message?.parts).toEqual([{ kind: "text", text: "claude timed out" }]);
  });

  it("extracts the text part from the incoming user message", async () => {
    runClaudeMock.mockResolvedValue({ text: "ok" });
    const bus = new FakeEventBus();
    const executor = new RedshiftAgentExecutor();

    await executor.execute(fakeContext("what tables exist?"), bus);

    expect(runClaudeMock).toHaveBeenCalledWith("what tables exist?", {});
  });
});
