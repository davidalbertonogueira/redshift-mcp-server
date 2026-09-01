#!/usr/bin/env node
// End-to-end smoke test for the full A2A pet project: drives the real
// `claude` CLI (outer session) against the a2a-bridge MCP server, which
// makes a real A2A call to a2a-agent, whose executor drives a SECOND real
// `claude` CLI invocation (inner session) against this repo's own MCP
// server, connected to the local Postgres emulator (test/docker-compose.yml).
//
// This is a structural mirror of test/e2e/ask-redshift-mcp.mjs — same
// ephemeral --mcp-config + --strict-mcp-config scoping, same cleanup
// discipline — extended with one more hop (bridge -> A2A -> agent).
//
// Requires: the `claude` CLI installed and authenticated, and Docker.
// Not run as part of `npm test` / CI — this makes two real LLM calls per
// run and costs API usage. Run manually with `npm run test:e2e:a2a`.

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const composeFile = path.join(repoRoot, "test", "docker-compose.yml");
const agentDir = path.join(repoRoot, "a2a-agent");
const bridgeDir = path.join(repoRoot, "a2a-bridge");
const bridgeEntry = path.join(bridgeDir, "dist", "index.js");

// Matches test/db-url.ts (kept as a plain literal here, same as ask-redshift-mcp.mjs).
const DATABASE_URL = "redshift://redshift:redshift@localhost:5439/analytics";
const AGENT_PORT = 4100; // distinct from a2a-agent's dev default (4000), avoids clashing with a manually-running instance
const AGENT_BASE_URL = `http://localhost:${AGENT_PORT}`;

const BRIDGE_SERVER_NAME = "redshift-a2a-bridge";
const PROMPT =
  `Using the ${BRIDGE_SERVER_NAME} MCP server's ask_redshift_agent tool, ask: ` +
  `"How many orders have status 'completed'? Reply with only the number." ` +
  "Then reply with only that number, nothing else.";
const EXPECTED_ANSWER = "5"; // See test/docker/init/01_sample_data.sql

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

function run(label, cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { stdio: "inherit", cwd: repoRoot, shell: isWindows, ...opts });
}

async function waitForAgent(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/.well-known/agent-card.json`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await delay(250);
  }
  throw new Error(`a2a-agent did not become ready at ${url} within ${timeoutMs}ms`);
}

let tmpDir;
let dbStarted = false;
let agentProcess;

try {
  console.log("== Building the MCP server, a2a-agent, and a2a-bridge ==");
  run("build:server", npmCmd, ["run", "build"], { cwd: repoRoot });
  run("build:agent", npmCmd, ["run", "build"], { cwd: agentDir });
  run("build:bridge", npmCmd, ["run", "build"], { cwd: bridgeDir });

  console.log("\n== Starting the local Redshift emulator ==");
  run("db up", "docker", ["compose", "-f", composeFile, "up", "-d", "--wait"]);
  dbStarted = true;

  console.log(`\n== Starting a2a-agent on ${AGENT_BASE_URL} ==`);
  agentProcess = spawn("node", [path.join(agentDir, "dist", "index.js")], {
    cwd: agentDir,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(AGENT_PORT),
      AGENT_BASE_URL,
    },
    stdio: "inherit",
  });
  await waitForAgent(AGENT_BASE_URL);

  tmpDir = mkdtempSync(path.join(tmpdir(), "redshift-a2a-e2e-"));
  const mcpConfigPath = path.join(tmpDir, "mcp-config.json");
  writeFileSync(
    mcpConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          [BRIDGE_SERVER_NAME]: {
            command: "node",
            args: [bridgeEntry],
            env: { REDSHIFT_AGENT_URL: AGENT_BASE_URL },
          },
        },
      },
      null,
      2
    )
  );

  console.log(`\n== Asking the outer Claude session, via the bridge, via A2A ==\n"${PROMPT}"`);
  const output = execFileSync(
    "claude",
    [
      "-p",
      PROMPT,
      "--mcp-config",
      mcpConfigPath,
      "--strict-mcp-config",
      "--restricted",
      "--allowedTools",
      `mcp__${BRIDGE_SERVER_NAME}__ask_redshift_agent`,
      "--output-format",
      "json",
      "--max-budget-usd",
      "1.00", // two nested LLM calls this time
    ],
    { cwd: repoRoot, encoding: "utf-8", timeout: 180_000 }
  );

  const parsed = JSON.parse(output);
  const answer = String(parsed.result ?? "").trim();
  console.log(`\nOuter Claude's answer: ${JSON.stringify(answer)}`);

  if (!answer.includes(EXPECTED_ANSWER)) {
    throw new Error(
      `Expected the answer to mention "${EXPECTED_ANSWER}" completed orders, got: ${answer}`
    );
  }

  console.log(
    "\n✅ E2E check passed: bridge -> A2A -> agent -> inner claude -p -> MCP tools -> Postgres all round-tripped correctly."
  );
} finally {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  if (agentProcess) {
    agentProcess.kill();
  }
  if (dbStarted && process.env.KEEP_TEST_DB !== "true") {
    console.log("\n== Stopping the local Redshift emulator ==");
    run("db down", "docker", ["compose", "-f", composeFile, "down", "-v"]);
  }
}
