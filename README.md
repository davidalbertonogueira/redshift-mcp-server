# Redshift MCP Server

**Give AI assistants secure, read-only access to your Amazon Redshift data warehouse.**

This TypeScript-based [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server enables LLMs to inspect schemas, execute queries, and understand your data warehouse structure.

> 🌟 Based on the [original implementation](https://github.com/paschmaria/redshift-mcp-server) by paschmaria, with production-ready enhancements.

## ✨ Features

- 🔒 **Read-only queries** with automatic transaction safety
- 🏗️ **Schema introspection** - tables, columns, relationships
- 📊 **Smart sampling** - optional PII redaction (emails, phones)
- 📈 **Statistics** - table sizes, row counts, distribution keys
- 🔍 **Column search** - find columns across all schemas
- 🚀 **Dual modes** - STDIO (IDEs) + HTTP (web/cloud)
- 🔐 **Bearer auth** - production-ready security
- ☸️ **Cloud-native** - stateless mode, health checks, K8s-ready
- 🐳 **Docker** - single-command deployment

## 🚀 Quick Start

### Local Setup (5 minutes)

```bash
# 1. Clone and install
git clone <repository-url>
cd redshift-mcp-server
npm install

# 2. Build
npm run build

# 3. Configure
export DATABASE_URL="redshift://user:pass@host:5439/db?ssl=true"

# 4. Run (STDIO mode for IDE)
npm start

# OR run HTTP mode for web/cloud
export TRANSPORT_MODE="http"
npm start
# Server: http://localhost:3000/mcp or http://localhost:3000/
```

### Docker (1 minute)

```bash
# Build
docker build -t redshift-mcp:latest .

# Run STDIO (for IDEs)
docker run -e DATABASE_URL='redshift://...' -i --rm redshift-mcp:latest

# Run HTTP with auth (for production)
docker run \
  -e DATABASE_URL='redshift://...' \
  -e TRANSPORT_MODE=http \
  -e STATELESS_MODE=true \
  -e ENABLE_AUTH=true \
  -e API_TOKEN=your-secret-token \
  -e REDACT_PII=false \
  -p 3000:3000 \
  redshift-mcp:latest
```

---

## 📋 Table of Contents

- [Configuration](#-configuration)
- [Transport Modes](#-transport-modes)
- [Authentication](#-authentication)
- [IDE Integration](#-ide-integration)
- [Dust.tt Integration](#-dusttt-integration)
- [Kubernetes Deployment](#%EF%B8%8F-kubernetes-deployment)
- [Available Tools](#-available-tools)
- [Troubleshooting](#-troubleshooting)

---

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ Yes | - | Redshift connection string |
| `TRANSPORT_MODE` | No | `stdio` | `stdio` for IDEs, `http` for web/cloud |
| `PORT` | No | `3000` | HTTP server port |
| `STATELESS_MODE` | No | `false` | `true` for horizontal scaling |
| `ENABLE_AUTH` | No | `false` | Enable Bearer token authentication |
| `API_TOKEN` | No | - | Bearer token (required if `ENABLE_AUTH=true`) |
| `ALLOWED_ORIGINS` | No | `*` | CORS allowed origins |
| `ENABLE_RESUMABILITY` | No | `false` | Event resumability (stateful mode only) |
| `REDACT_PII` | No | `false` | Redact email/phone in output data |

### Database URL Format

```
redshift://username:password@hostname:port/database?ssl=true&timeout=600
```

**Example:**
```bash
DATABASE_URL="redshift://admin:MyPass123@cluster.us-east-1.redshift.amazonaws.com:5439/analytics?ssl=true"
```

### Configuration File (`.env`)

```bash
# Copy example
cp .env.example .env

# Edit with your values
DATABASE_URL="redshift://..."
TRANSPORT_MODE="http"
STATELESS_MODE="true"
ENABLE_AUTH="true"
API_TOKEN="your-secret-token-here"
REDACT_PII="false"
```

---

## 🔄 Transport Modes

Choose the right transport mode for your use case:

### STDIO Mode (Default)

**Best for:** IDEs, CLI tools, local development

```bash
# Default mode - no configuration needed
export DATABASE_URL="redshift://..."
npm start
```

**Clients:**
- Cursor IDE
- Windsurf
- Claude Desktop
- Custom CLI tools

**How it works:** Communicates via standard input/output streams

### HTTP Mode

**Best for:** Web apps, Dust.tt, Kubernetes, remote integrations

```bash
# Enable HTTP transport
export DATABASE_URL="redshift://..."
export TRANSPORT_MODE="http"
npm start
```

**Endpoints:**
- `POST/GET/DELETE /mcp` - MCP protocol endpoint
- `POST/GET/DELETE /` - Root path (alias for `/mcp`)
- `GET /health` - Health check with metrics
- `GET /ready` - Readiness probe

**Stateful vs Stateless:**

| Mode | Best For | Sessions | Scaling | Set With |
|------|----------|----------|---------|----------|
| **Stateful** | IDE clients, MCP Inspector | ✅ Session-based | Needs sticky sessions | `STATELESS_MODE=false` (default) |
| **Stateless** | Dust.tt, K8s, APIs | ❌ No sessions | ✅ Horizontal scaling | `STATELESS_MODE=true` |

**Production recommendation:** Use `STATELESS_MODE=true` for cloud deployments

---

## 🔐 Authentication

### Bearer Token Auth (Production)

Enable authentication for production deployments (required for Dust.tt, recommended for K8s):

```bash
export TRANSPORT_MODE="http"
export ENABLE_AUTH="true"
export API_TOKEN="your-super-secret-token-here"
npm start
```

**How it works:**
1. Clients send requests with `Authorization: Bearer <token>` header
2. Server validates token against `API_TOKEN`
3. Invalid/missing tokens receive `401 Unauthorized`

**Security features:**
- OPTIONS requests (CORS preflight) don't require auth
- Health/ready endpoints don't require auth
- OAuth discovery endpoints return 404 (tells clients OAuth is not available)

**Testing authentication:**

```bash
# Without token - should fail
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1}'
# Returns: 401 Unauthorized

# With token - should work
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer your-super-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
# Returns: 200 OK with server capabilities
```

**Best practices:**
- Generate strong tokens: `openssl rand -hex 32`
- Store tokens in secrets (K8s Secrets, env vars, vault)
- Rotate tokens regularly (every 90 days)
- Use HTTPS in production (ngrok, load balancer, ingress)

---

## 💻 IDE Integration

### Cursor / Windsurf / Claude Desktop

**Add to your MCP config file:**
- Cursor: `.cursor/mcp.json`
- Windsurf: `mcp_config.json`
- Claude Desktop: `claude_desktop_config.json`

#### Option 1: Node.js (Recommended)

```json
{
  "mcpServers": {
    "redshift": {
      "command": "node",
      "args": ["/absolute/path/to/redshift-mcp-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "redshift://user:pass@host:5439/db?ssl=true",
        "REDACT_PII": "false"
      }
    }
  }
}
```

⚠️ **Important:** Use absolute paths, not relative paths!

#### Option 2: Docker

```json
{
  "mcpServers": {
    "redshift": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "DATABASE_URL",
        "-e", "REDACT_PII",
        "redshift-mcp:latest"
      ],
      "env": {
        "DATABASE_URL": "redshift://user:pass@host:5439/db?ssl=true",
        "REDACT_PII": "false"
      }
    }
  }
}
```

**After configuration:**
1. Restart your IDE
2. Tools appear automatically in MCP settings
3. Ask AI: "What tables are in my database?"

---

## 🌐 MCP Inspector (Testing Tool)

Anthropic's [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a web-based tool for testing MCP servers.

**Setup:**

```bash
# 1. Start server with auth (optional)
export DATABASE_URL="redshift://..."
export TRANSPORT_MODE="http"
export STATELESS_MODE="true"
export ENABLE_AUTH="true"
export API_TOKEN="test-token-123"
npm start
```

**2. Open MCP Inspector and connect:**
- **Transport:** Streamable HTTP
- **Connection:** Direct
- **URL:** `http://localhost:3000/mcp` or `http://localhost:3000/`
- **Authentication:** Custom Header (if enabled)
  - Header: `Authorization`
  - Value: `Bearer test-token-123`

**3. Test tools:**
- List tools
- Execute `query` tool
- Check resources

---

## ☁️ Dust.tt Integration

[Dust.tt](https://dust.tt) supports remote MCP servers. Here's how to connect:

### Step 1: Expose Your Server

**Option A: ngrok (Quick testing)**

```bash
# Start server with auth
export DATABASE_URL="redshift://..."
export TRANSPORT_MODE="http"
export STATELESS_MODE="true"
export ENABLE_AUTH="true"
export API_TOKEN="your-secret-token"
npm start

# In another terminal, expose
ngrok http 3000
# You'll get: https://abc123.ngrok.io
```

**Option B: Kubernetes (Production)**

See [Kubernetes Deployment](#%EF%B8%8F-kubernetes-deployment) section below.

### Step 2: Configure in Dust.tt

1. Go to Dust.tt → **Connections** → **Add MCP Server**
2. Fill in:
   - **Server Name:** Redshift Data Warehouse
   - **URL:** `https://your-ngrok-url.ngrok.io/mcp` or `https://your-domain.com/mcp`
   - **Authentication:** Bearer Token
   - **Token:** `your-secret-token` (same as `API_TOKEN`)
3. Click **Save**

✅ **Success!** Dust.tt agents can now query your Redshift data.

**Troubleshooting:**
- ❌ "404 Not Found" → Use `/mcp` suffix or root `/` path
- ❌ "401 Unauthorized" → Check token matches `API_TOKEN` exactly
- ❌ "OAuth error" → Select "Bearer Token" auth (not "Automatic")

### Step 3: Test in Dust.tt

Ask your Dust.tt agent:
- "What tables are in my Redshift database?"
- "Show me the schema of the users table"
- "How many rows are in the orders table?"

**Learn more:** [Dust.tt MCP Guide](https://blog.dust.tt/give-dust-agents-access-to-your-internal-systems-with-custom-mcp-servers/)

---


## ☸️ Kubernetes Deployment

**Production-ready K8s deployment with horizontal scaling:**

**Complete manifest:**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: redshift-mcp-secrets
type: Opaque
stringData:
  database-url: "redshift://user:pass@host:5439/db?ssl=true"
  api-token: "your-super-secret-token"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redshift-mcp-server
spec:
  replicas: 3  # Horizontal scaling with stateless mode
  selector:
    matchLabels:
      app: redshift-mcp-server
  template:
    metadata:
      labels:
        app: redshift-mcp-server
    spec:
      containers:
      - name: server
        image: your-registry/redshift-mcp:latest
        ports:
        - containerPort: 3000
        env:
        - name: TRANSPORT_MODE
          value: "http"
        - name: STATELESS_MODE
          value: "true"  # Enable for horizontal scaling
        - name: ENABLE_AUTH
          value: "true"
        - name: API_TOKEN
          valueFrom:
            secretKeyRef:
              name: redshift-mcp-secrets
              key: api-token
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: redshift-mcp-secrets
              key: database-url
        - name: ALLOWED_ORIGINS
          value: "https://dust.tt"
        - name: REDACT_PII
          value: "false"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: redshift-mcp-service
spec:
  selector:
    app: redshift-mcp-server
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: ClusterIP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: redshift-mcp-ingress
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - mcp.your-company.com
    secretName: mcp-tls
  rules:
  - host: mcp.your-company.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: redshift-mcp-service
            port:
              number: 80
```

**Key configuration points:**

| Feature | Configuration | Why |
|---------|---------------|-----|
| **Horizontal Scaling** | `STATELESS_MODE=true`, `replicas: 3` | No sticky sessions needed |
| **Security** | `ENABLE_AUTH=true`, token in Secret | Protect your data |
| **Health Checks** | `/health` and `/ready` endpoints | Auto-restart unhealthy pods |
| **TLS** | Ingress with cert-manager | HTTPS required for production |
| **Resources** | Adjust based on query load | Start with 256Mi RAM, 100m CPU |

---

## 🛠️ Available Tools

The MCP server exposes these tools to AI assistants:

### 1. `query` - Execute SQL

**Execute read-only SQL queries** with automatic transaction safety.

```json
// Input
{
  "sql": "SELECT table_name FROM information_schema.tables LIMIT 10"
}

// Output
[
  {"table_name": "users"},
  {"table_name": "orders"},
  ...
]
```

**Features:**
- Automatic `BEGIN TRANSACTION READ ONLY`
- Safe for production use
- Returns results as JSON array

**Example prompts:**
- "Show me all tables in the public schema"
- "What are the top 10 customers by revenue?"
- "Count rows in the orders table"

### 2. `describe_table` - Table Schema

**Get comprehensive table information** including columns, data types, and Redshift-specific attributes.

```json
// Input
{
  "schema": "public",
  "table": "users"
}

// Output
{
  "schema": "public",
  "table": "users",
  "columns": [
    {
      "column_name": "id",
      "data_type": "integer",
      "is_nullable": "NO",
      "is_distkey": true,
      "is_sortkey": true
    },
    ...
  ]
}
```

**Includes:**
- Column names and data types
- Nullability
- Distribution keys (DISTKEY)
- Sort keys (SORTKEY)
- Defaults and constraints

**Example prompts:**
- "Describe the structure of the users table"
- "What columns are in the orders table?"
- "Show me the schema for public.payments"

### 3. `find_column` - Search Columns

**Find tables containing columns** matching a search pattern.

```json
// Input
{
  "pattern": "email"
}

// Output
[
  {
    "table_schema": "public",
    "table_name": "users",
    "column_name": "email",
    "data_type": "varchar"
  },
  {
    "table_schema": "public",
    "table_name": "contacts",
    "column_name": "contact_email",
    "data_type": "varchar"
  }
]
```

**Use cases:**
- Find all tables with customer IDs
- Locate PII fields across schemas
- Discover relationships between tables

**Example prompts:**
- "Find all columns containing 'customer'"
- "Which tables have an 'updated_at' column?"
- "Search for columns with 'amount' in the name"

### Resources (Contextual Information)

These are auto-discovered and provided to AI assistants:

| Resource | URI Pattern | Description |
|----------|-------------|-------------|
| **Schema Lists** | `redshift://host/schema/{schema}` | All tables in a schema |
| **Table Schemas** | `redshift://host/{schema}/{table}/schema` | Column definitions, keys |
| **Sample Data** | `redshift://host/{schema}/{table}/sample` | 5 sample rows (unredacted by default) |
| **Statistics** | `redshift://host/{schema}/{table}/statistics` | Size, rows, distribution |

**PII Redaction:** Email and phone fields can be redacted in sample data by setting `REDACT_PII=true` (disabled by default).

---

## 🔧 Troubleshooting

### Common Issues

#### ❌ Connection Fails

**Symptoms:** `ENOTFOUND`, `ECONNREFUSED`, or timeout errors

**Solutions:**
1. **Check DATABASE_URL format**:
   ```bash
   redshift://username:password@cluster.region.redshift.amazonaws.com:5439/database?ssl=true
   ```
2. **Verify network access:** Security groups, VPC settings, public access
3. **Test with psql:** `psql "$DATABASE_URL"`

#### ❌ Authentication 401 Unauthorized

**Solutions:**
1. Verify token matches: `API_TOKEN="abc123"` → `Authorization: Bearer abc123`
2. Select "Bearer Token" in Dust.tt (not "Automatic")
3. Check request headers in logs

#### ❌ MCP Inspector Won't Connect

**Solutions:**
1. Enable stateless mode: `STATELESS_MODE="true"`
2. Use correct URL: `http://localhost:3000/mcp` or `http://localhost:3000/`
3. Add auth header if enabled: `Authorization: Bearer your-token`

#### ❌ Dust.tt 404 Not Found

**Solutions:**
1. Use full path: `https://your-ngrok-url.ngrok.io/mcp`
2. Check ngrok logs for actual requests
3. Verify auth token is correct

#### ❌ IDE Tools Not Showing

**Solutions:**
1. Use absolute paths in config
2. Verify build: `npm run build && ls -la dist/index.js`
3. Restart IDE after config changes

### Debug Commands

```bash
# Health check
curl http://localhost:3000/health

# Test with auth
curl -H "Authorization: Bearer token" http://localhost:3000/mcp

# Test DB connection
psql "$DATABASE_URL" -c "SELECT 1;"
```

---

## 🏗️ Architecture

```
src/
├── core/
│   └── redshift-tools.ts     # Pure DB logic (transport-agnostic)
├── mcp/
│   └── server.ts             # MCP protocol handler
├── transports/
│   ├── stdio.ts              # STDIO transport
│   └── streamable-http.ts    # HTTP/SSE transport
├── middleware/
│   └── auth.ts               # Bearer token authentication
└── index.ts                  # Application entry point
```

**Key principles:**
- 🧩 **Core logic** is transport-agnostic (reusable)
- 🔌 **Transports** are pluggable (STDIO, HTTP, WebSocket)
- 🔒 **Middleware** is modular (auth, CORS, logging)
- ⚙️ **Config** is environment-driven (12-factor)

**See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.**

---

## 📚 Resources

- [MCP Specification](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Dust.tt MCP Guide](https://blog.dust.tt/give-dust-agents-access-to-your-internal-systems-with-custom-mcp-servers/)
- [Original Implementation](https://github.com/paschmaria/redshift-mcp-server)

---

## 🔐 Security

**Built-in protections:**
- 🔒 **Read-only transactions** - All queries in `BEGIN TRANSACTION READ ONLY`
- 😷 **PII redaction** - Optional email/phone redaction in samples
- 🔐 **Bearer auth** - Token-based access control
- 🔒 **SSL/TLS** - Encrypted database connections

**Best practices:**
1. Use dedicated **read-only Redshift user**
2. Limit **permissions** to necessary schemas/tables
3. Enable **auth for production**: `ENABLE_AUTH=true`
4. Use **strong tokens**: `openssl rand -hex 32`
5. **Rotate credentials** every 90 days
6. Deploy in **private network** when possible
7. **Monitor query logs** for suspicious activity

---

## 📝 License & Credits

**Based on:** [paschmaria/redshift-mcp-server](https://github.com/paschmaria/redshift-mcp-server)

**Enhancements:**
- ✅ Streamable HTTP + stateless mode
- ✅ Bearer token authentication
- ✅ Kubernetes-ready deployment
- ✅ Root path (`/`) + OAuth discovery
- ✅ Clean architecture with separation of concerns

**HTTP Transport Inspiration:**
The HTTP/SSE transport implementation took inspiration from:
- [mcp-streamable-http](https://github.com/invariantlabs-ai/mcp-streamable-http)
- [mcp-streamable-http-typescript-server](https://github.com/ferrants/mcp-streamable-http-typescript-server)
- [http-oauth-mcp-server](https://github.com/NapthaAI/http-oauth-mcp-server)

**Stack:** TypeScript 5.3+ | Node.js 16+ | MCP SDK 1.8.0 | Express.js

---

**🚀 Questions? Issues? PRs welcome!**
