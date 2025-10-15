# Redshift MCP Server - Complete Documentation

## Project Overview

**Redshift MCP Server** is a TypeScript-based Model Context Protocol (MCP) server that provides AI assistants with secure, read-only access to Amazon Redshift data warehouses. This server enables LLMs to inspect database schemas, execute queries, and provide contextual information about your data warehouse structure.

### Key Features
- 🔒 **Read-only access** with transaction safety
- 🏗️ **Schema introspection** for all tables and columns
- 📊 **Sample data** with automatic PII redaction
- 📈 **Table statistics** including size and row counts
- 🔍 **Column search** across all tables
- 🐳 **Docker support** for easy deployment
- 🛡️ **Security-first** design with input sanitization

## Technology Stack

- **Language**: TypeScript 5.3+
- **Runtime**: Node.js 16+
- **Protocol**: Model Context Protocol (MCP) 1.8.0
- **Database**: Amazon Redshift (via PostgreSQL driver)
- **Transport**: Standard I/O (stdio)
- **Build**: TypeScript Compiler (tsc)
- **Container**: Docker with Alpine Linux

## Project Structure

```
redshift-mcp-server/
├── src/
│   └── index.ts              # Main server implementation
├── dist/                     # Compiled JavaScript output
├── test-mcp.ts              # Testing utility
├── Dockerfile               # Container configuration
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── README.md                # User documentation
└── GEMINI.md               # This comprehensive guide
```

## Installation & Setup

### Prerequisites
- Node.js 16+ and npm
- Access to Amazon Redshift cluster
- Docker (optional, for containerized deployment)

### Local Development Setup

```bash
# Clone the repository
git clone <repository-url>
cd redshift-mcp-server

# Install dependencies
npm install

# Build the project
npm run build

# Set up environment
export DATABASE_URL="redshift://username:password@hostname:5439/database?ssl=true"

# Run in development mode
npm run dev

# Or run compiled version
npm start
```

### Docker Setup

```bash
# Build Docker image
docker build -t redshift-mcp:latest .

# Run with environment variable
docker run -e DATABASE_URL='redshift://user:pass@host:5439/db?ssl=true' -i --rm redshift-mcp:latest
```

## Build & Deploy Commands

### Development Commands
```bash
npm run dev          # Run with ts-node (development)
npm run build        # Compile TypeScript to JavaScript
npm start            # Run compiled JavaScript
npm test             # Run tests (placeholder)
```

### Docker Commands
```bash
# Build image
docker build -t redshift-mcp:v1.0 .

# Run interactively
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:v1.0

# Build and tag for production
docker build -t your-registry/redshift-mcp:latest .
docker push your-registry/redshift-mcp:latest
```

### Production Deployment
```bash
# Using Docker Compose (create docker-compose.yml)
version: '3.8'
services:
  redshift-mcp:
    image: redshift-mcp:latest
    environment:
      - DATABASE_URL=redshift://user:pass@host:5439/db?ssl=true
    stdin_open: true
    tty: true
```

## Configuration

### Database Connection
The server requires a `DATABASE_URL` environment variable in this format:
```
redshift://username:password@hostname:port/database?ssl=true&timeout=10
```

**Parameters:**
- `username`: Redshift username
- `password`: Redshift password  
- `hostname`: Cluster endpoint (e.g., `cluster.region.redshift.amazonaws.com`)
- `port`: Usually 5439
- `database`: Database name
- `ssl=true`: Enable SSL (recommended)
- `timeout=10`: Connection timeout in seconds

### MCP Client Configuration

#### Cursor IDE Setup
Create `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "redshift-mcp": {
      "command": "node",
      "args": ["path/to/dist/index.js"],
      "env": {
        "DATABASE_URL": "redshift://user:pass@host:5439/db?ssl=true"
      }
    }
  }
}
```

## Testing & Validation

### Basic Connectivity Test
```bash
# Test MCP protocol without database
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | npx ts-node --esm test-mcp.ts
```

### Full Server Testing

#### 1. List Available Tools
```bash
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | \
docker run -e DATABASE_URL='redshift://user:pass@host:5439/db?ssl=true' -i --rm redshift-mcp:latest
```

**Expected Response:**
```json
{
  "result": {
    "tools": [
      {"name": "query", "description": "Run a read-only SQL query against Redshift"},
      {"name": "describe_table", "description": "Get detailed information about a specific table"},
      {"name": "find_column", "description": "Find tables containing columns with specific name patterns"}
    ]
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

#### 2. Execute SQL Query
```bash
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT COUNT(*) as total_tables FROM information_schema.tables"}},"id":2}' | \
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:latest
```

#### 3. Describe Table Structure
```bash
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"describe_table","arguments":{"schema":"public","table":"users"}},"id":3}' | \
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:latest
```

#### 4. Find Columns by Pattern
```bash
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"find_column","arguments":{"pattern":"email"}},"id":4}' | \
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:latest
```

#### 5. List Available Resources
```bash
echo '{"jsonrpc":"2.0","method":"resources/list","params":{},"id":5}' | \
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:latest
```

### Test Data Examples
```bash
# Simple query test
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT 1 as test, CURRENT_TIMESTAMP as now"}},"id":1}' | \
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:latest

# Check distinct values in a column
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT DISTINCT feature_name FROM silver.feature_payments LIMIT 10"}},"id":2}' | \
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:latest
```

## Available Tools & Resources

### Tools (Executable Functions)

1. **query**
   - Execute read-only SQL queries
   - Automatic transaction safety (BEGIN READ ONLY)
   - Input: `{"sql": "SELECT statement"}`
   - Output: JSON array of query results

2. **describe_table** 
   - Get comprehensive table information
   - Input: `{"schema": "schema_name", "table": "table_name"}`
   - Output: Column definitions, data types, constraints, statistics

3. **find_column**
   - Search for columns by name pattern
   - Input: `{"pattern": "search_term"}`
   - Output: List of tables containing matching columns

### Resources (Contextual Information)

1. **Schema Listings** (`redshift://host/schema/{schema_name}`)
   - All tables within a schema
   - Automatically discovered from database metadata

2. **Table Schemas** (`redshift://host/{schema}/{table}/schema`)
   - Column definitions with Redshift-specific attributes
   - Distribution keys, sort keys, data types

3. **Sample Data** (`redshift://host/{schema}/{table}/sample`)
   - Up to 5 sample rows per table
   - Automatic PII redaction (email, phone fields)

4. **Table Statistics** (`redshift://host/{schema}/{table}/statistics`)
   - Size, row count, creation time
   - Distribution style, compression info

## Troubleshooting Guide

### Common Issues & Solutions

#### 1. "Method not found" Error
**Problem**: Using incorrect MCP method names
**Solution**: Use correct protocol methods:
- ✅ `tools/list` (not `mcp/listTools`)
- ✅ `tools/call` (not `mcp/callTool`)
- ✅ `resources/list` (not `mcp/listResources`)
- ✅ `resources/read` (not `mcp/readResource`)

#### 2. DNS Resolution Errors
**Problem**: `getaddrinfo ENOTFOUND hostname`
**Solution**: 
- Verify Redshift cluster hostname is correct
- Check network connectivity from Docker container
- Ensure cluster is publicly accessible or configure VPC access

#### 3. Authentication Failures
**Problem**: Connection refused or authentication errors
**Solution**:
- Verify username/password in DATABASE_URL
- Check Redshift cluster security groups
- Ensure user has CONNECT privilege on database

#### 4. No JSON Response (Only URL Output)
**Problem**: Server starts but doesn't respond to requests
**Solution**:
```bash
# Test basic connectivity first
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | docker run -i --rm redshift-mcp:latest

# Check for errors in logs
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:latest 2>&1 | head -20
```

#### 5. SQL Syntax Errors
**Problem**: Query fails with syntax errors
**Solution**:
- Use double quotes for string literals in JSON
- Escape single quotes in SQL: `'Company liquidation'` → `\"Company liquidation\"`
- Test queries with simple SELECT statements first

### Debug Commands
```bash
# Test without database connection
npx ts-node --esm test-mcp.ts

# Verbose Docker output
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:latest 2>&1

# Check compiled JavaScript
npm run build && node dist/index.js

# Validate JSON-RPC format
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | jq .
```

## Security Considerations

### Built-in Security Features
- **Read-only transactions**: All queries wrapped in `BEGIN TRANSACTION READ ONLY`
- **Input sanitization**: Parameterized queries prevent SQL injection
- **PII redaction**: Automatic redaction of email/phone in sample data
- **No password exposure**: Credentials not included in resource URIs
- **Connection encryption**: SSL/TLS enabled by default

### Best Practices
- Use dedicated read-only Redshift user
- Limit database permissions to necessary schemas/tables
- Run in secure network environment
- Monitor query logs for unusual activity
- Regularly rotate database credentials

## Development & Debugging History

### Root Cause Discovery (Debugging Session)
The initial "Method not found" errors were caused by using incorrect MCP protocol method names. The solution was discovered by:

1. **Creating minimal test servers** to isolate the problem
2. **Inspecting SDK schemas** to find actual method names:
   ```typescript
   console.log("Method def:", ListToolsRequestSchema.shape.method._def);
   // Output: { value: 'tools/list', typeName: 'ZodLiteral' }
   ```
3. **Testing with correct method names** confirmed the server was working

### Key Improvements Made
1. **Better Schema Definitions**: Used `zod` and `zodToJsonSchema` for proper tool schema generation
2. **Explicit Capabilities**: Set capabilities to `{ tools: { list: {}, call: {} }, resources: { list: {} } }`
3. **SDK Version**: Pinned to `@modelcontextprotocol/sdk: ^1.8.0`

### Lessons Learned
- MCP protocol method names differ from intuitive expectations
- Always verify actual schema definitions when debugging protocol issues
- Use debugging tools like schema inspection to understand APIs
- The original server code was correct - only test method names were wrong

## Contributing & Extension

### Adding New Tools
```typescript
// In src/index.ts, add to CallToolRequestSchema handler
if (request.params.name === "new_tool") {
  const param = request.params.arguments?.param as string;
  // Implementation here
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: false,
  };
}
```

### Adding New Resources
```typescript
// In src/index.ts, add to ReadResourceRequestSchema handler
if (resourceType === "new_resource") {
  const result = await client.query(`SELECT * FROM new_table`);
  // Implementation here
}
```

### Testing New Features
```bash
# Test new tool
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"new_tool","arguments":{"param":"value"}},"id":1}' | \
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:test
```

