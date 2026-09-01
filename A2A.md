# A2A Pet Project (Experimental)

Two extra packages, `a2a-agent/` and `a2a-bridge/`, that expose this MCP server to *other agents* over the [A2A (Agent2Agent) protocol](https://a2a-protocol.org), instead of just to the Claude Code session sitting on top of it.

**Status:** experimental, unpublished, not part of the `@davidalbertonogueira/redshift-mcp-server` npm package. Sibling folders at the repo root, each its own `npm` package — `.gitignore` and the release workflow (`.github/workflows/publish-mcp.yml`) both ignore them, so they can't affect the published server.

## Why this exists

`redshift-mcp-server` is an MCP *server*: a host app (Claude Code, Cursor, ...) with its own LLM connects to it and calls its tools directly. A2A answers a different question — how does one autonomous agent delegate a task to a *different* agent it doesn't control, without seeing that agent's internal tools or prompts? This pet project answers that concretely: it wraps this repo's MCP server behind an A2A-speaking agent, whose own reasoning loop is a headless Claude Code CLI call (`claude -p`) — reusing a Claude subscription seat instead of metered API/Bedrock billing.

## Architecture

```
Your Claude Code session          a2a-bridge (MCP, stdio)         a2a-agent (A2A, HTTP :4000)
┌─────────────────────┐  MCP    ┌────────────────────────┐  A2A  ┌──────────────────────────┐
│ "ask the redshift    │ ──────► │ ask_redshift_agent tool │ ────► │ RedshiftAgentExecutor      │
│  agent how many..."  │         │ (ClientFactory.sendMsg) │       │  -> spawns `claude -p`     │
└─────────────────────┘         └────────────────────────┘       │     (subscription seat)    │
                                                                    │  -> that inner claude -p   │
                                                                    │     talks MCP to           │
                                                                    │     dist/index.js (stdio)  │
                                                                    └──────────────────────────┘
```

`a2a-agent`'s executor doesn't implement its own MCP client — it shells out to `claude -p`, which already *is* one, pointed at this repo's unmodified, already-built `dist/index.js` via an ephemeral `--mcp-config`. `a2a-bridge` is what lets a *different* Claude Code session reach `a2a-agent`, since Claude Code has no native A2A client, only MCP.

The exact `claude -p` flags used by `a2a-agent/src/claude-runner.ts` are a direct port of the ones already proven in [`test/e2e/ask-redshift-mcp.mjs`](./test/e2e/ask-redshift-mcp.mjs) — see that file for the original validation.

## How it works

### `a2a-agent`

**[`claude-runner.ts`](./a2a-agent/src/claude-runner.ts)** — the piece that actually shells out to Claude:
```
buildMcpConfig(serverEntryPath, databaseUrl):
    return { mcpServers: { redshift: { command: "node", args: [serverEntryPath], env: { DATABASE_URL } } } }

buildClaudeArgs(taskText, mcpConfigPath, maxBudgetUsd):
    return ["-p", taskText,
            "--mcp-config", mcpConfigPath, "--strict-mcp-config", "--restricted",
            "--allowedTools", "mcp__redshift__query,mcp__redshift__describe_table,mcp__redshift__find_column",
            "--output-format", "json", "--max-budget-usd", maxBudgetUsd]

parseClaudeOutput(stdout):
    return JSON.parse(stdout).result.trim()   // throws if stdout isn't valid JSON

runClaude(taskText):
    tmpDir = make a temp dir
    write buildMcpConfig(pathToRootDistIndexJs, process.env.DATABASE_URL) → tmpDir/mcp-config.json
    try:
        stdout = spawn("claude", buildClaudeArgs(taskText, mcpConfigPath), timeout=120s)
        return { text: parseClaudeOutput(stdout) }
    catch err:
        return { error: err.message }          // non-zero exit, timeout, bad JSON — all land here
    finally:
        delete tmpDir
```

**[`executor.ts`](./a2a-agent/src/executor.ts)** — the A2A task lifecycle around that call:
```
class RedshiftAgentExecutor:
    execute(requestContext, eventBus):
        taskText = text of requestContext.userMessage's first text part
        eventBus.publish( Task{ id, contextId, status: "submitted" } )
        eventBus.publish( StatusUpdate{ status: "working", final: false } )

        result = await runClaude(taskText)

        if result has "error":
            eventBus.publish( StatusUpdate{ status: "failed", message: result.error, final: true } )
        else:
            eventBus.publish( StatusUpdate{ status: "completed", message: result.text, final: true } )

    cancelTask(): no-op   // single execFile call, nothing to interrupt for v1
```

**[`agent-card.ts`](./a2a-agent/src/agent-card.ts)** — just a static data object: name/description/`url`/`capabilities: {streaming:false}`/one `skill` ("query-redshift").

**[`index.ts`](./a2a-agent/src/index.ts)** — wiring, no logic of its own:
```
agentCard = buildAgentCard(baseUrl)
requestHandler = new DefaultRequestHandler(agentCard, InMemoryTaskStore(), new RedshiftAgentExecutor())

app = express()
app.use(express.json())
app.use("/.well-known/agent-card.json", agentCardHandler(requestHandler))
app.use(jsonRpcHandler(requestHandler))   // routes message/send etc. to requestHandler → executor
app.listen(port, "localhost")
```

### `a2a-bridge`

**[`server.ts`](./a2a-bridge/src/server.ts)** — the one MCP tool and the A2A call it makes:
```
TOOL_NAME = "ask_redshift_agent"

extractText(result):                      // result is a Message OR a Task
    message = result.kind == "message" ? result : result.status.message
    return join(message's text parts)

handleListTools():
    return [ { name: TOOL_NAME, inputSchema: { question: string } } ]

handleCallTool(request, agentUrl, createClient):
    if request.toolName != TOOL_NAME: return isError
    question = request.arguments.question
    try:
        client = await createClient(agentUrl)      // real one: ClientFactory().createFromUrl(agentUrl)
        result = await client.sendMessage({ message: { role: "user", parts: [{ text: question }] } })
        return { content: [ text: extractText(result) ] }
    catch err:
        return { isError: true, content: [ text: "Error calling redshift agent: " + err.message ] }

createBridgeServer(agentUrl):
    server = new Server(...)
    server.setRequestHandler(ListTools, handleListTools)
    server.setRequestHandler(CallTool, req => handleCallTool(req, agentUrl))
    return server
```

**[`index.ts`](./a2a-bridge/src/index.ts)**:
```
agentUrl = env.REDSHIFT_AGENT_URL ?? "http://localhost:4000"
server = createBridgeServer(agentUrl)
server.connect(new StdioServerTransport())
```

## Configuration

### `a2a-agent/.env` (copy from `a2a-agent/.env.example`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Same Redshift connection string as the root server; forwarded to the inner `claude -p`'s MCP server subprocess |
| `PORT` | No | `4000` | Port the A2A HTTP server listens on |
| `AGENT_BASE_URL` | No | `http://localhost:${PORT}` | The `url` published in the agent's `AgentCard` — must be reachable at whatever address `a2a-bridge` (or any other A2A client) will use |

Binds to `localhost` only — this is a local pet project, not something to expose beyond your machine (see [Known limitations](#known-limitations)).

### `a2a-bridge/.env` (copy from `a2a-bridge/.env.example`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDSHIFT_AGENT_URL` | No | `http://localhost:4000` | Base URL of the running `a2a-agent` |

### Prerequisites (both packages)

- Node.js **>=20** (the root server only requires >=16; `@a2a-js/sdk` needs 20+)
- The `claude` CLI installed and logged in with a Claude subscription seat — no `ANTHROPIC_API_KEY` needed, and none should be set if you want to confirm it's actually riding the subscription rather than metered billing
- The root server built (`npm run build` at repo root) — `a2a-agent` spawns `dist/index.js` directly

## Running it

Commands are given for bash (macOS/Linux/Git Bash) first, with a PowerShell equivalent under each where the syntax actually differs — plain `npm`/`node`/`claude` invocations are identical in both.

### 1. Build everything

```bash
npm run build                 # repo root
cd a2a-agent && npm install && npm run build && cd ..
cd a2a-bridge && npm install && npm run build && cd ..
```

Identical in PowerShell — `&&` chaining works the same way in modern PowerShell (7+); on Windows PowerShell 5.1, run each command on its own line instead:

```powershell
npm run build
cd a2a-agent; npm install; npm run build; cd ..
cd a2a-bridge; npm install; npm run build; cd ..
```

### 2. Start the agent

```bash
cd a2a-agent
cp .env.example .env          # then edit DATABASE_URL
DATABASE_URL="redshift://user:pass@host:5439/db?ssl=true" npm start
```

```powershell
cd a2a-agent
Copy-Item .env.example .env   # then edit DATABASE_URL
$env:DATABASE_URL = "redshift://user:pass@host:5439/db?ssl=true"
npm start                     # listens on http://localhost:4000
```
`$env:DATABASE_URL` only lives for that PowerShell process — closing the window is all the cleanup it needs, it won't leak into other terminals.

### 3. Point a Claude Code session at the bridge (in a separate terminal/session)

```bash
claude mcp add redshift-a2a-bridge -s local \
  -e REDSHIFT_AGENT_URL=http://localhost:4000 \
  -- node /absolute/path/to/a2a-bridge/dist/index.js
```

```powershell
claude mcp add redshift-a2a-bridge -s local `
  -e REDSHIFT_AGENT_URL=http://localhost:4000 `
  -- node "$PWD\a2a-bridge\dist\index.js"
```
(PowerShell's line-continuation character is a backtick `` ` ``, not `\` — and `\` in `$PWD\a2a-bridge\...` is a literal path separator here, not an escape.)

### 4. Ask it something

*"Using the redshift agent, how many orders have status 'completed'?"* — same in both shells, since that's just talking to `claude` interactively.

That registers the bridge **durably** (written to your local Claude Code config, stays until `claude mcp remove redshift-a2a-bridge`) — the right choice for an interactive session where you'll ask it several things.

### One-shot, nothing-persisted alternative

Same pattern [`test/e2e/ask-redshift-agent.mjs`](./test/e2e/ask-redshift-agent.mjs) actually uses, and the one to reach for in any automation — write a throwaway `--mcp-config` and skip `claude mcp add` entirely:

```bash
cat > /tmp/mcp-config.json <<'EOF'
{
  "mcpServers": {
    "redshift-a2a-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/a2a-bridge/dist/index.js"],
      "env": { "REDSHIFT_AGENT_URL": "http://localhost:4000" }
    }
  }
}
EOF

claude -p "How many orders have status 'completed'?" \
  --mcp-config /tmp/mcp-config.json \
  --strict-mcp-config \
  --restricted \
  --allowedTools "mcp__redshift-a2a-bridge__ask_redshift_agent" \
  --output-format json \
  --max-budget-usd 0.50
```

```powershell
$config = @{
  mcpServers = @{
    "redshift-a2a-bridge" = @{
      command = "node"
      args    = @("$PWD\a2a-bridge\dist\index.js")
      env     = @{ REDSHIFT_AGENT_URL = "http://localhost:4000" }
    }
  }
}
$config | ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii mcp-config.json

claude -p "How many orders have status 'completed'?" `
  --mcp-config mcp-config.json `
  --strict-mcp-config `
  --restricted `
  --allowedTools "mcp__redshift-a2a-bridge__ask_redshift_agent" `
  --output-format json `
  --max-budget-usd 0.50
```
**Don't** hand-write the JSON as a here-string (`@"..."@ | Set-Content`) on Windows — two things go wrong at once: `Set-Content -Encoding utf8` on Windows PowerShell 5.1 always writes a **UTF-8 BOM**, which `claude` rejects with `MCP config is not a valid JSON` before it even looks at the content; and a raw Windows path like `$PWD\a2a-bridge\...` interpolated straight into a JSON string produces **invalid escape sequences** (`\a`, `\d`, ...), since JSON only allows `\\` for a literal backslash. `ConvertTo-Json` above sidesteps both — it escapes the path correctly, and `-Encoding ascii` has no BOM to begin with (safe here since every value is plain ASCII).

The tool name after the double underscore is always `ask_redshift_agent` (the bridge's one and only tool, defined in `a2a-bridge/src/server.ts`) — the part before it is whatever server name you pick at registration time, `redshift-a2a-bridge` here to match the bridge's own `package.json` name and the e2e script's config.

### Sanity-checking the agent on its own, before wiring up the bridge

```bash
curl http://localhost:4000/.well-known/agent-card.json

curl -X POST http://localhost:4000/ -H "Content-Type: application/json" -d '{
  "jsonrpc":"2.0","id":1,"method":"message/send",
  "params":{"message":{"kind":"message","messageId":"11111111-1111-1111-1111-111111111111","role":"user","parts":[{"kind":"text","text":"Reply with exactly one word: OK"}]}}}'
```

```powershell
curl.exe http://localhost:4000/.well-known/agent-card.json

$body = @{
  jsonrpc = "2.0"
  id      = 1
  method  = "message/send"
  params  = @{
    message = @{
      kind      = "message"
      messageId = "11111111-1111-1111-1111-111111111111"
      role      = "user"
      parts     = @(@{ kind = "text"; text = "Reply with exactly one word: OK" })
    }
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri http://localhost:4000/ -Method Post -ContentType "application/json" -Body $body
```
Use `curl.exe` explicitly, not bare `curl` — PowerShell aliases `curl` to `Invoke-WebRequest`, which takes different flags and will silently misinterpret `-X`/`-d`. For the JSON-RPC POST, `Invoke-RestMethod` plus `ConvertTo-Json` avoids hand-escaping nested quotes in a `-d` string, which is genuinely painful in PowerShell.

## Testing

Same two-tier convention as the root server's own test suite ([README → Testing](./README.md#-testing)): fast mocked tests in `npm test`, a real-LLM-call script kept opt-in.

### Unit tests — `npm test` in each package

```bash
cd a2a-agent && npm test     # claude-runner argv/parsing + executor event-sequence tests, all mocked, no real claude/Redshift calls
cd a2a-bridge && npm test    # tool schema + Message/Task text extraction, A2A client mocked, no network calls
```

Safe to run repeatedly, safe for CI, costs nothing.

### End-to-end — `npm run test:e2e:a2a` (repo root)

```bash
npm run test:e2e:a2a
```

Builds the root server, `a2a-agent`, and `a2a-bridge`; starts the Postgres/Redshift-shim emulator ([`test/docker-compose.yml`](./test/docker-compose.yml)); starts `a2a-agent` on port `4100`; then drives a real **outer** `claude -p` call against `a2a-bridge`'s `ask_redshift_agent` tool, which makes a real A2A call into `a2a-agent`, whose executor makes a real **inner** `claude -p` call against the actual MCP tools and the emulator. Asserts the final answer matches the known seed data (5 completed orders, see [`test/docker/init/01_sample_data.sql`](./test/docker/init/01_sample_data.sql)), then tears everything down — emulator, `a2a-agent` process, temp files.

**Requires:** the `claude` CLI installed and authenticated, and Docker. **Not run in CI or as part of `npm test`** — it makes two real, nested LLM calls per run and costs usage (each call capped via `--max-budget-usd`).

## Known limitations (deliberate, for a one-week scope)

- **No streaming.** `message/send`, not `message/stream` — `claude -p --output-format json` is itself a blocking call with nothing incremental to stream from.
- **No auth on the A2A endpoint.** `UserBuilder.noAuthentication`, bound to `localhost`. The root server's [`src/middleware/auth.ts`](./src/middleware/auth.ts) bearer-token pattern is directly reusable if this ever needs to leave your machine.
- **One `claude -p` subprocess per A2A task**, no pooling/queueing — fine at pet-project scale; N concurrent requests means N concurrent Redshift connections, each from a freshly-spawned MCP server child.
- **`@a2a-js/sdk` is pinned to `0.3.14`** (exact, not `^`) in both packages. `npm install @a2a-js/sdk` today resolves `1.1.0`, a breaking rewrite of the wire format (flat `AgentCard.url` → `supportedInterfaces[]`, text `Part` → a different discriminated union, `message/send` → `SendMessage`). Don't bump this without re-checking the SDK's migration guide.
- **`a2a-bridge` pins `@modelcontextprotocol/sdk` to `1.20.0` exactly** (matching the root server's currently-resolved version) plus a `zod-to-json-schema` override to `3.24.6`, to dodge a TypeScript type-checking regression between newer `@modelcontextprotocol/sdk` releases (which pull `zod` v4) and `zod-to-json-schema@3.25.x`. `npm audit` will flag `@modelcontextprotocol/sdk@1.20.0` for known advisories (DNS-rebinding protection, ReDoS, cross-client transport reuse) fixed in `1.30.0` — same version root already pins, not a regression introduced here, and low real risk given `a2a-bridge` only runs over local stdio to a single client.
