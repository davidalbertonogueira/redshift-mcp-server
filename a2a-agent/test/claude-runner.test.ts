import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClaudeArgs,
  buildMcpConfig,
  DEFAULT_SERVER_ENTRY,
  parseClaudeOutput,
} from "../src/claude-runner.js";

describe("DEFAULT_SERVER_ENTRY", () => {
  it("is an absolute path to the sibling repo's built dist/index.js", () => {
    expect(path.isAbsolute(DEFAULT_SERVER_ENTRY)).toBe(true);
    expect(DEFAULT_SERVER_ENTRY.endsWith(path.join("dist", "index.js"))).toBe(true);
    // a2a-agent/test -> a2a-agent -> repo root; DEFAULT_SERVER_ENTRY -> dist -> repo root
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    expect(path.dirname(path.dirname(DEFAULT_SERVER_ENTRY))).toBe(path.resolve(testDir, "..", ".."));
  });
});

describe("buildMcpConfig", () => {
  it("registers the redshift MCP server with the given absolute entry path and DB URL", () => {
    const config = buildMcpConfig("/abs/path/dist/index.js", "redshift://u:p@h:5439/db");
    expect(config).toEqual({
      mcpServers: {
        redshift: {
          command: "node",
          args: ["/abs/path/dist/index.js"],
          env: { DATABASE_URL: "redshift://u:p@h:5439/db" },
        },
      },
    });
  });
});

describe("buildClaudeArgs", () => {
  it("passes the task text as a single argv element and includes all three redshift tools", () => {
    const args = buildClaudeArgs("how many orders?", "/tmp/mcp-config.json", "0.50");

    expect(args).toEqual([
      "-p",
      "how many orders?",
      "--mcp-config",
      "/tmp/mcp-config.json",
      "--strict-mcp-config",
      "--restricted",
      "--allowedTools",
      "mcp__redshift__query,mcp__redshift__describe_table,mcp__redshift__find_column",
      "--output-format",
      "json",
      "--max-budget-usd",
      "0.50",
    ]);
  });

  it("never interpolates task text into a shell string, even if it looks shell-metacharacter-laden", () => {
    const dangerous = "5; rm -rf / #";
    const args = buildClaudeArgs(dangerous, "/tmp/mcp-config.json", "0.50");
    // The dangerous text must appear as exactly one argv element, untouched.
    expect(args.filter((a) => a === dangerous)).toHaveLength(1);
  });
});

describe("parseClaudeOutput", () => {
  it("extracts and trims the .result field", () => {
    expect(parseClaudeOutput('{"result": "  5  "}')).toBe("5");
  });

  it("returns an empty string when .result is missing", () => {
    expect(parseClaudeOutput("{}")).toBe("");
  });

  it("throws on malformed JSON, so callers can map it to a failed task", () => {
    expect(() => parseClaudeOutput("not json")).toThrow();
  });
});

describe("runClaude", () => {
  it("resolves to { error } instead of throwing when the claude CLI fails to spawn", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFile: (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (err: Error | null, stdout?: string) => void
      ) => callback(new Error("spawn claude ENOENT")),
    }));

    const { runClaude } = await import("../src/claude-runner.js");
    const result = await runClaude("hello");

    expect(result).toEqual({ error: "spawn claude ENOENT" });
    vi.doUnmock("node:child_process");
  });

  it("resolves to { error } when claude succeeds but stdout isn't valid JSON", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFile: (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (err: Error | null, stdout?: string) => void
      ) => callback(null, "not valid json"),
    }));

    const { runClaude } = await import("../src/claude-runner.js");
    const result = await runClaude("hello");

    expect(result).toHaveProperty("error");
    vi.doUnmock("node:child_process");
  });
});
