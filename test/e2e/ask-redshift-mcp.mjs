#!/usr/bin/env node
// End-to-end smoke test: drives the real `claude` CLI against this MCP
// server, connected to the local Postgres emulator (test/docker-compose.yml).
//
// The MCP server is registered with `claude -p` via `--mcp-config` +
// `--strict-mcp-config`, which scopes it to this single, non-interactive
// invocation only. Nothing is written to any persistent Claude Code config
// (project, user, or local settings), so there is no "disconnect" step —
// the server was never added anywhere durable in the first place, and other
// sessions on this machine are unaffected regardless of how this script
// exits.
//
// Requires: the `claude` CLI installed and authenticated, and Docker.
// Not run as part of `npm test` / CI — this makes a real LLM call and costs
// API usage. Run manually with `npm run test:e2e`.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const composeFile = path.join(repoRoot, "test", "docker-compose.yml");
const serverEntry = path.join(repoRoot, "dist", "index.js");

// Matches test/db-url.ts (kept as a plain literal here since this script
// isn't compiled and shouldn't depend on the TS build to parse it).
const DATABASE_URL = "redshift://redshift:redshift@localhost:5439/analytics";

const SERVER_NAME = "redshift-e2e";
const PROMPT =
  "Using the redshift-e2e MCP server's query tool, tell me how many orders " +
  "have status 'completed'. Reply with only the number, nothing else.";
const EXPECTED_ANSWER = "5"; // See test/docker/init/01_sample_data.sql

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

function run(label, cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  // Windows .cmd shims (npm.cmd) require shell:true since Node refuses to
  // spawn them directly (CVE-2024-27980 mitigation).
  return execFileSync(cmd, args, {
    stdio: "inherit",
    cwd: repoRoot,
    shell: isWindows,
    ...opts,
  });
}

let tmpDir;
let dbStarted = false;

try {
  console.log("== Building the server ==");
  run("build", npmCmd, ["run", "build"]);

  console.log("\n== Starting the local Redshift emulator ==");
  run("db up", "docker", ["compose", "-f", composeFile, "up", "-d", "--wait"]);
  dbStarted = true;

  tmpDir = mkdtempSync(path.join(tmpdir(), "redshift-mcp-e2e-"));
  const mcpConfigPath = path.join(tmpDir, "mcp-config.json");
  writeFileSync(
    mcpConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          [SERVER_NAME]: {
            command: "node",
            args: [serverEntry],
            env: {
              DATABASE_URL,
              TRANSPORT_MODE: "stdio",
            },
          },
        },
      },
      null,
      2
    )
  );

  console.log(`\n== Asking Claude via an ephemeral MCP connection ==\n"${PROMPT}"`);
  const output = execFileSync(
    "claude",
    [
      "-p",
      PROMPT,
      "--mcp-config",
      mcpConfigPath,
      "--strict-mcp-config", // ignore every other MCP config on this machine
      "--restricted", // drop Bash/PowerShell/etc, ignore project/user settings
      "--allowedTools",
      `mcp__${SERVER_NAME}__query`, // pre-approve just the one tool we need
      "--output-format",
      "json",
      "--max-budget-usd",
      "0.50",
    ],
    { cwd: repoRoot, encoding: "utf-8", timeout: 120_000 }
  );

  const parsed = JSON.parse(output);
  const answer = String(parsed.result ?? "").trim();
  console.log(`\nClaude's answer: ${JSON.stringify(answer)}`);

  if (!answer.includes(EXPECTED_ANSWER)) {
    throw new Error(
      `Expected the answer to mention "${EXPECTED_ANSWER}" completed orders, got: ${answer}`
    );
  }

  console.log("\n✅ E2E check passed: the MCP server answered correctly via the real Claude CLI.");
} finally {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  if (dbStarted && process.env.KEEP_TEST_DB !== "true") {
    console.log("\n== Stopping the local Redshift emulator ==");
    run("db down", "docker", ["compose", "-f", composeFile, "down", "-v"]);
  }
}
