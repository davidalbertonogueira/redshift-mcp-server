# Debugging Session with Gemini (Claude)

## Problem
The MCP server was returning `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}` when testing with what we thought were the correct method names.

## Root Cause Discovery
After extensive debugging, the issue was discovered to be **incorrect method names** in the test requests.

### Wrong Method Names (what we were using):
- `mcp/listTools`
- `mcp/callTool` 
- `mcp/listResources`
- `mcp/readResource`

### Correct Method Names (MCP Protocol):
- `tools/list`
- `tools/call`
- `resources/list` 
- `resources/read`

## How We Found It
1. Created minimal test servers to isolate the problem
2. Inspected the SDK's `ListToolsRequestSchema` to find the actual method name:
   ```typescript
   console.log("Method def:", ListToolsRequestSchema.shape.method._def);
   // Output: { value: 'tools/list', typeName: 'ZodLiteral' }
   ```

## Testing Commands

### JSON-RPC Protocol Explanation
Each MCP request follows the JSON-RPC 2.0 format:
- `"jsonrpc":"2.0"` - Protocol version (required)
- `"method":"tools/list"` - The MCP method to call
- `"params":{...}` - Parameters for the method (can be empty `{}`)
- `"id":1` - Request identifier (can be any number/string, used to match responses)

The `id` field helps match responses to requests when multiple requests are sent. You can use any value like `1`, `2`, `"test"`, etc.

### Test Tools
```bash
# List available tools
# Returns: {"result":{"tools":[...]}, "jsonrpc":"2.0", "id":1}
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | docker run -e DATABASE_URL='...' -i --rm redshift-mcp:fixed2

# Call a tool (simple query)
# Returns: {"result":{"content":[{"type":"text","text":"[{\"test\":1}]"}]}, "jsonrpc":"2.0", "id":2}
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT 1 as test"}},"id":2}' | docker run -e DATABASE_URL='...' -i --rm redshift-mcp:fixed2

# Call a tool (complex query example)
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT COUNT(*) as total_rows FROM information_schema.tables"}},"id":3}' | docker run -e DATABASE_URL='...' -i --rm redshift-mcp:fixed2
```

### Test Resources
```bash
# List available resources
echo '{"jsonrpc":"2.0","method":"resources/list","params":{},"id":3}' | docker run -e DATABASE_URL='...' -i --rm redshift-mcp:fixed2

# Read a specific resource
echo '{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"redshift://schema/public"},"id":4}' | docker run -e DATABASE_URL='...' -i --rm redshift-mcp:fixed2
```

### Simple Test Server
Use `test-mcp.ts` for basic connectivity testing:
```bash
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | npx ts-node --esm test-mcp.ts
```

## Troubleshooting

### Issue: Only URL output, no SQL results
If you see only the URL object but no JSON-RPC response, this usually means:

1. **Server crashed or failed to start** - Check if there are error messages after the URL
2. **Database connection failed** - The server might be failing silently on DB connection
3. **SQL syntax error** - Your query might have syntax issues

**Debug steps:**
```bash
# 1. Test basic connectivity first (no DB required)
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | docker run -i --rm redshift-mcp:fixed2

# 2. Test with a simple query
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT 1"}},"id":2}' | docker run -e DATABASE_URL='...' -i --rm redshift-mcp:fixed2

# 3. Check Docker logs for errors
docker run -e DATABASE_URL='...' -i --rm redshift-mcp:fixed2 2>&1 | head -20
```

### Common SQL Issues
- **Single quotes in SQL**: Escape them or use double quotes for string literals
- **Complex queries**: Break them down into simpler parts first
- **Table permissions**: Ensure your user has access to the tables/schemas

### Expected Response Format
A successful tool call should return:
```json
{
  "result": {
    "content": [
      {
        "type": "text", 
        "text": "[{\"column1\":\"value1\",\"column2\":\"value2\"}]"
      }
    ],
    "isError": false
  },
  "jsonrpc": "2.0",
  "id": 2
}
```

An error response looks like:
```json
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Error executing query: [error message]"
      }
    ],
    "isError": true
  },
  "jsonrpc": "2.0", 
  "id": 2
}
```

## Improvements Made
1. **Better Schema Definitions**: Used `zod` and `zodToJsonSchema` for proper tool schema generation
2. **Explicit Capabilities**: Set capabilities to `{ tools: { list: {}, call: {} }, resources: { list: {} } }`
3. **SDK Version**: Pinned to `@modelcontextprotocol/sdk: ^1.8.0`

## Key Learnings
- The MCP protocol method names are different from what intuition might suggest
- Always check the actual schema definitions when debugging protocol issues
- The server code was correct from the beginning - only the test method names were wrong
- Use debugging tools like schema inspection to understand the actual API

## Files
- `test-mcp.ts` - Simple test server for basic connectivity testing
- `src/index.ts` - Main server with improvements
- `redshift-mcp:fixed2` - Working Docker image
