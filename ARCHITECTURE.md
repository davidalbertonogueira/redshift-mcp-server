# Redshift MCP Server - Architecture

## Overview

This MCP server has been refactored with clean separation of concerns to support multiple deployment scenarios:
- **Local development** with IDE integration (STDIO transport)
- **Production deployment** on Kubernetes with authentication (Streamable HTTP transport)
- **Stateful** (session-based) and **stateless** (horizontally scalable) modes

## Architecture Layers

### Layer 1: Core Business Logic
**Location**: `src/core/redshift-tools.ts`

Pure business logic with no transport or MCP awareness:
- Database connection management
- Query execution (read-only transactions)
- Schema introspection
- PII redaction
- Table statistics

**Key Class**: `RedshiftTools`

```typescript
const tools = new RedshiftTools(databaseUrl);
await tools.query("SELECT * FROM table");
await tools.describeTable("schema", "table");
await tools.findColumn("pattern");
```

### Layer 2: MCP Server Definition
**Location**: `src/mcp/server.ts`

Transport-agnostic MCP protocol implementation:
- Tool registration (query, describe_table, find_column)
- Resource registration (schemas, tables, samples, statistics)
- Request schema validation using Zod
- Error handling

**Key Function**: `createRedshiftMcpServer(databaseUrl: string): Server`

### Layer 3: Transport Implementations

#### STDIO Transport
**Location**: `src/transports/stdio.ts`

Simple wrapper for standard input/output communication:
```typescript
await runStdioTransport(mcpServer);
```

Used by: Claude Desktop, Cursor IDE, Windsurf

#### Streamable HTTP Transport
**Location**: `src/transports/streamable-http.ts`

Full HTTP server with:
- POST `/mcp` - Client sends messages to server
- GET `/mcp` - Client opens SSE stream for server messages
- DELETE `/mcp` - Client terminates session
- GET `/health` - Health check
- GET `/ready` - Readiness probe (K8s)

**Key Class**: `StreamableHttpTransportManager`

**Features**:
- Session management (stateful mode)
- Stateless mode for horizontal scaling
- Event resumability (reconnection support)
- CORS configuration
- Security headers
- Request logging
- Graceful shutdown

### Layer 4: Middleware
**Location**: `src/middleware/auth.ts`

Authentication middleware for production deployments:
- Bearer token authentication
- Skips auth for health/ready endpoints
- Returns proper JSON-RPC error responses

Future: Can be extended for OAuth support using MCP SDK

### Layer 5: Application Entry Point
**Location**: `src/index.ts`

Orchestrates everything:
1. Loads configuration from environment
2. Creates MCP server instance
3. Selects transport based on `TRANSPORT_MODE`
4. Applies middleware (if enabled)
5. Starts the appropriate transport

## Data Flow

### STDIO Mode
```
IDE/CLI → STDIN → StdioTransport → MCP Server → RedshiftTools → Redshift
                                                                ↓
IDE/CLI ← STDOUT ← StdioTransport ← MCP Server ← RedshiftTools ← Query Results
```

### HTTP Mode (Stateful)
```
Client → POST /mcp (InitializeRequest) → Create Transport + Session → MCP Server
                                                                          ↓
Client ← Response with Mcp-Session-Id ← Transport ← MCP Server ← RedshiftTools

Client → POST /mcp (with session ID) → Reuse Transport → MCP Server → RedshiftTools
                                                                          ↓
Client ← JSON Response ← Transport ← MCP Server ← RedshiftTools ← Query Results

Client → GET /mcp (with session ID) → SSE Stream → Server-initiated messages
```

### HTTP Mode (Stateless)
```
Client → POST /mcp (InitializeRequest) → Create Ephemeral Transport → MCP Server
                                                                          ↓
Client ← Response (no session ID) ← Transport (destroyed) ← MCP Server ← Results

(Next request creates new transport from scratch)
```

## File Structure

```
src/
├── index.ts                    # Application entry point
├── core/
│   └── redshift-tools.ts       # Business logic layer
├── mcp/
│   └── server.ts               # MCP protocol layer
├── transports/
│   ├── stdio.ts                # STDIO transport
│   └── streamable-http.ts      # HTTP transport manager
└── middleware/
    └── auth.ts                 # Authentication middleware
```

## Configuration

All configuration via environment variables (see `.env.example`):

| Variable | Purpose | Default |
|----------|---------|---------|
| `DATABASE_URL` | Redshift connection | Required |
| `TRANSPORT_MODE` | Transport type | `stdio` |
| `PORT` | HTTP server port | `3000` |
| `STATELESS_MODE` | Enable stateless | `false` |
| `ENABLE_RESUMABILITY` | Enable reconnection | `false` |
| `ENABLE_AUTH` | Enable auth | `false` |
| `API_TOKEN` | Bearer token | - |
| `ALLOWED_ORIGINS` | CORS origins | `*` |

## Deployment Scenarios

### Scenario 1: Local Development (STDIO)
```bash
export DATABASE_URL="redshift://..."
npm start
```
Used in `.cursor/mcp.json` or Windsurf config.

### Scenario 2: Local Development (HTTP)
```bash
export TRANSPORT_MODE="http"
export DATABASE_URL="redshift://..."
npm run start:http
```
For testing with MCP Inspector or browser clients.

### Scenario 3: Kubernetes Production (Stateless)
```yaml
env:
  - name: TRANSPORT_MODE
    value: "http"
  - name: STATELESS_MODE
    value: "true"
  - name: ENABLE_AUTH
    value: "true"
  - name: API_TOKEN
    valueFrom: { secretKeyRef: ... }
  - name: DATABASE_URL
    valueFrom: { secretKeyRef: ... }
```
Horizontal scaling with load balancer.

### Scenario 4: Kubernetes Production (Stateful)
```yaml
env:
  - name: TRANSPORT_MODE
    value: "http"
  - name: STATELESS_MODE
    value: "false"
  - name: ENABLE_RESUMABILITY
    value: "true"
  - name: ENABLE_AUTH
    value: "true"
```
Requires sticky sessions on load balancer.

## Design Principles

1. **Separation of Concerns**: Each layer has single responsibility
2. **Transport Agnostic**: Core logic works with any transport
3. **Testable**: Business logic can be unit tested independently
4. **Extensible**: Easy to add new transports or middleware
5. **Production Ready**: Security, health checks, graceful shutdown
6. **Spec Compliant**: Follows MCP Streamable HTTP specification

## Benefits

- ✅ Same codebase for all deployment scenarios
- ✅ Easy to test (mock database, mock transport)
- ✅ Clear boundaries between layers
- ✅ Future-proof (OAuth, new transports, etc.)
- ✅ Horizontally scalable (stateless mode)
- ✅ Production-ready (auth, monitoring, K8s support)
