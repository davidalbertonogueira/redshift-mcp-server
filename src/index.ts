#!/usr/bin/env node
import { createRedshiftMcpServer } from "./mcp/server.js";
import { runStdioTransport } from "./transports/stdio.js";
import { StreamableHttpTransportManager } from "./transports/streamable-http.js";
import { createAuthMiddleware } from "./middleware/auth.js";

/**
 * Main entry point for Redshift MCP Server.
 * Supports multiple transport modes via environment configuration.
 */
async function main() {
  // ==================== CONFIGURATION ====================
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required");
    console.error("Example: DATABASE_URL='redshift://user:pass@host:5439/db?ssl=true'");
    process.exit(1);
  }

  // Backward compatibility: HTTP_MODE=true maps to TRANSPORT_MODE=http
  let transportMode = process.env.TRANSPORT_MODE;
  if (!transportMode && process.env.HTTP_MODE === "true") {
    console.error("⚠️  Warning: HTTP_MODE is deprecated. Please use TRANSPORT_MODE=http instead.");
    transportMode = "http";
  }
  transportMode = transportMode || "stdio"; // Default to stdio
  
  const port = parseInt(process.env.PORT || "3000");
  const statelessMode = process.env.STATELESS_MODE === "true";
  const enableResumability = process.env.ENABLE_RESUMABILITY === "true";
  const enableAuth = process.env.ENABLE_AUTH === "true";
  const apiToken = process.env.API_TOKEN;
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  const redactPII = process.env.REDACT_PII === "true";

  // Validate auth config
  if (enableAuth && !apiToken) {
    console.error("ERROR: ENABLE_AUTH=true requires API_TOKEN to be set");
    process.exit(1);
  }

  // ==================== CREATE MCP SERVER ====================
  
  console.error("Creating Redshift MCP Server...");
  const mcpServer = createRedshiftMcpServer({ 
    databaseUrl, 
    redactPII 
  });
  console.error("MCP Server created successfully");

  // ==================== SELECT TRANSPORT ====================

  if (transportMode === "stdio") {
    // STDIO mode - for local IDE integration
    await runStdioTransport(mcpServer);
  } 
  else if (transportMode === "http") {
    // Streamable HTTP mode - for web clients, Dust.tt, K8s deployment
    const manager = new StreamableHttpTransportManager(mcpServer, {
      port,
      mcpEndpoint: "/mcp",
      enableResumability,
      enableStatelessMode: statelessMode,
      enableCors: true,
      allowedOrigins: allowedOrigins || "*",
      enableAuth,
      apiToken,
    });

    manager.listen();
  } 
  else {
    console.error(`ERROR: Unknown transport mode: ${transportMode}`);
    console.error("Valid options: 'stdio' or 'http'");
    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
