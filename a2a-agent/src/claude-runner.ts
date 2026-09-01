// Drives the real `claude` CLI in headless/print mode against the sibling
// redshift-mcp-server, reusing whatever Claude subscription seat is already
// logged in on this machine (no ANTHROPIC_API_KEY needed).
//
// The flag set and output parsing here are a direct port of the proven,
// working invocation in test/e2e/ask-redshift-mcp.mjs at the repo root —
// see that file for the original validation of these exact flags.

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Not util.promisify(execFile): that relies on child_process's custom
// promisify symbol, which a plain vi.mock("node:child_process") in tests
// doesn't reproduce. This thin wrapper keeps the callback contract explicit
// and easy to mock.
function execFileAsync(
  cmd: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number }
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (error, stdout) => {
      if (error) reject(error);
      else resolve({ stdout: stdout.toString() });
    });
  });
}

const SERVER_NAME = "redshift";
const ALLOWED_TOOLS = [
  `mcp__${SERVER_NAME}__query`,
  `mcp__${SERVER_NAME}__describe_table`,
  `mcp__${SERVER_NAME}__find_column`,
].join(",");

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/claude-runner.js -> ../.. -> repo root -> dist/index.js
export const DEFAULT_SERVER_ENTRY = path.resolve(here, "..", "..", "dist", "index.js");

export type ClaudeRunResult = { text: string } | { error: string };

export interface RunClaudeOptions {
  /** Absolute path to the built redshift-mcp-server entry point (dist/index.js). */
  serverEntryPath?: string;
  databaseUrl?: string;
  timeoutMs?: number;
  maxBudgetUsd?: string;
}

/** The `--mcp-config` JSON registering the sibling MCP server for this one invocation. */
export function buildMcpConfig(serverEntryPath: string, databaseUrl: string) {
  return {
    mcpServers: {
      [SERVER_NAME]: {
        command: "node",
        args: [serverEntryPath],
        env: { DATABASE_URL: databaseUrl },
      },
    },
  };
}

/** The full argv passed to the `claude` binary, given an already-written mcp-config path. */
export function buildClaudeArgs(
  taskText: string,
  mcpConfigPath: string,
  maxBudgetUsd: string
): string[] {
  return [
    "-p",
    taskText,
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config", // ignore every other MCP config on this machine
    "--restricted", // drop Bash/PowerShell/etc, ignore project/user settings
    "--allowedTools",
    ALLOWED_TOOLS,
    "--output-format",
    "json",
    "--max-budget-usd",
    maxBudgetUsd,
  ];
}

/** Parses `claude -p --output-format json` stdout into the answer text. Throws on malformed JSON. */
export function parseClaudeOutput(stdout: string): string {
  const parsed = JSON.parse(stdout);
  return String(parsed.result ?? "").trim();
}

export async function runClaude(taskText: string, options: RunClaudeOptions = {}): Promise<ClaudeRunResult> {
  const serverEntryPath = options.serverEntryPath ?? DEFAULT_SERVER_ENTRY;
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? "";
  const timeout = options.timeoutMs ?? 120_000;
  const maxBudgetUsd = options.maxBudgetUsd ?? "0.50";

  const tmpDir = mkdtempSync(path.join(tmpdir(), "redshift-a2a-agent-"));
  const mcpConfigPath = path.join(tmpDir, "mcp-config.json");

  try {
    writeFileSync(mcpConfigPath, JSON.stringify(buildMcpConfig(serverEntryPath, databaseUrl)));

    const { stdout } = await execFileAsync(
      "claude",
      buildClaudeArgs(taskText, mcpConfigPath, maxBudgetUsd),
      { timeout, maxBuffer: 10 * 1024 * 1024 }
    );

    return { text: parseClaudeOutput(stdout) };
  } catch (err) {
    return { error: (err as Error).message };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
