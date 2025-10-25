import express, { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { randomUUID } from "crypto";

export interface StreamableHttpOptions {
  port: number;
  mcpEndpoint: string; // e.g., "/mcp"
  enableResumability?: boolean;
  enableStatelessMode?: boolean;
  enableCors?: boolean;
  allowedOrigins?: string;
  enableAuth?: boolean;
  apiToken?: string;
}

/**
 * Manages Streamable HTTP transport for MCP server.
 * Supports both stateful (session-based) and stateless modes.
 */

export class StreamableHttpTransportManager {
  private app: express.Application;
  private transports: Map<string, StreamableHTTPServerTransport> = new Map();
  private server: Server;
  private options: StreamableHttpOptions;
  private httpServer: any;

  constructor(server: Server, options: StreamableHttpOptions) {
    this.server = server;
    this.options = {
      enableResumability: false,
      enableStatelessMode: false,
      enableCors: true,
      allowedOrigins: "*",
      enableAuth: false,
      ...options,
    };
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // JSON body parser
    this.app.use(express.json());

    // Authentication (if enabled)
    if (this.options.enableAuth && this.options.apiToken) {
      this.app.use(createAuthMiddleware({ token: this.options.apiToken }));
      console.error("[Middleware] Authentication enabled - Bearer token required");
    }
    // CORS (if enabled)
    if (this.options.enableCors) {
      this.app.use((req, res, next) => {
        const origin = this.options.allowedOrigins || "*";
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID, Accept"
        );
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, DELETE, OPTIONS"
        );
        
        if (req.method === "OPTIONS") {
          res.status(204).end();
          return;
        }
        next();
      });
    }

    // Security headers
    this.app.use((req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    const endpoint = this.options.mcpEndpoint;

    // POST: Client sends messages to server
    this.app.post(endpoint, (req, res, next) => this.handlePost(req, res, next));

    // GET: Client opens SSE stream for server messages
    this.app.get(endpoint, (req, res, next) => this.handleGet(req, res, next));

    // DELETE: Client terminates session
    this.app.delete(endpoint, (req, res, next) => this.handleDelete(req, res, next));

    // Root path handlers (for clients that don't specify /mcp)
    // This allows Dust.tt and other clients to connect to https://host/ instead of https://host/mcp
    if (endpoint !== "/") {
      this.app.post("/", (req, res, next) => this.handlePost(req, res, next));
      this.app.get("/", (req, res, next) => this.handleGet(req, res, next));
      this.app.delete("/", (req, res, next) => this.handleDelete(req, res, next));
    }

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        mode: this.options.enableStatelessMode ? "stateless" : "stateful",
        activeSessions: this.transports.size,
        timestamp: new Date().toISOString(),
      });
    });

    // Readiness probe (for K8s)
    this.app.get("/ready", (req, res) => {
      // Could add DB connection check here
      res.json({ status: "ready" });
    });
  }

  /**
   * Handle POST requests - client sending messages to server
   */
  private async handlePost(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      // Debug logging
      console.error(`[POST] Headers:`, JSON.stringify(req.headers, null, 2));
      console.error(`[POST] Body method:`, req.body?.method);
      console.error(`[POST] Session ID from header:`, sessionId);
      console.error(`[POST] Is Initialize:`, isInitializeRequest(req.body));
      console.error(`[POST] Active sessions:`, Array.from(this.transports.keys()));

      // STATELESS MODE: Create ephemeral transport for every request
      if (this.options.enableStatelessMode) {
        console.error("[POST] ✅ Creating stateless transport (ephemeral)");
        transport = await this.createStatelessTransport();
      }
      // STATEFUL MODE: Case 1 - Existing session
      else if (sessionId && this.transports.has(sessionId)) {
        console.error(`[POST] ✅ Reusing session: ${sessionId}`);
        transport = this.transports.get(sessionId)!;
      }
      // STATEFUL MODE: Case 2 - New initialization
      else if (!sessionId && isInitializeRequest(req.body)) {
        console.error("[POST] ✅ Creating new stateful session");
        transport = await this.createStatefulTransport();
      }
      // Invalid request (stateful mode without valid session)
      else {
        console.error(`[POST] ❌ Invalid request - sessionId: ${sessionId}, isInit: ${isInitializeRequest(req.body)}`);
        console.error(`[POST] ❌ Request body:`, JSON.stringify(req.body, null, 2));
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: Missing or invalid session ID",
          },
          id: null,
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[POST] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  }

  /**
   * Handle GET requests - client opening SSE stream
   */
  private async handleGet(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (!sessionId || !this.transports.has(sessionId)) {
        console.error(`[GET] Invalid session ID: ${sessionId}`);
        res.status(400).send("Invalid or missing session ID");
        return;
      }

      const transport = this.transports.get(sessionId)!;
      const lastEventId = req.headers["last-event-id"] as string | undefined;

      if (lastEventId) {
        console.error(`[GET] Client resuming from event: ${lastEventId}`);
      } else {
        console.error(`[GET] Opening SSE stream for session: ${sessionId}`);
      }

      // Set up connection close handler
      res.on("close", () => {
        console.error(`[GET] SSE connection closed for session: ${sessionId}`);
      });

      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("[GET] Error:", error);
      if (!res.headersSent) {
        res.status(500).send("Internal server error");
      }
    }
  }

  /**
   * Handle DELETE requests - client terminating session
   */
  private async handleDelete(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (!sessionId || !this.transports.has(sessionId)) {
        console.error(`[DELETE] Invalid session ID: ${sessionId}`);
        res.status(400).send("Invalid or missing session ID");
        return;
      }

      console.error(`[DELETE] Terminating session: ${sessionId}`);
      const transport = this.transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("[DELETE] Error:", error);
      if (!res.headersSent) {
        res.status(500).send("Error processing session termination");
      }
    }
  }

  /**
   * Create a stateful transport with session management
   */
  private async createStatefulTransport(): Promise<StreamableHTTPServerTransport> {
    const eventStore = this.options.enableResumability
      ? new InMemoryEventStore()
      : undefined;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      eventStore,
      onsessioninitialized: (sessionId) => {
        console.error(`[Transport] Session initialized: ${sessionId}`);
        this.transports.set(sessionId, transport);
      },
    });

    // Cleanup on close
    transport.onclose = () => {
      if (transport.sessionId) {
        console.error(`[Transport] Session closed: ${transport.sessionId}`);
        this.transports.delete(transport.sessionId);
      }
    };

    // Connect to MCP server
    await this.server.connect(transport);
    console.error("[Transport] Connected to MCP server");

    return transport;
  }

  /**
   * Create a stateless transport (no session tracking)
   */
  private async createStatelessTransport(): Promise<StreamableHTTPServerTransport> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Explicitly disable session ID
      enableJsonResponse: true,
    });

    // Connect to MCP server
    await this.server.connect(transport);
    console.error("[Transport] Stateless transport connected to MCP server");

    return transport;
  }

  /**
   * Start the HTTP server
   */
  listen(): void {
    this.httpServer = this.app.listen(this.options.port, () => {
      console.error(`
========================================
MCP Streamable HTTP Server Started
========================================
Port:         ${this.options.port}
Endpoint:     http://localhost:${this.options.port}${this.options.mcpEndpoint}
Mode:         ${this.options.enableStatelessMode ? "STATELESS" : "STATEFUL"}
Resumability: ${this.options.enableResumability ? "ENABLED" : "DISABLED"}
CORS:         ${this.options.enableCors ? "ENABLED" : "DISABLED"}
Health:       http://localhost:${this.options.port}/health
========================================
      `.trim());
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.error("\n[Shutdown] Closing HTTP server...");
      
      // Close all active transports
      for (const [sessionId, transport] of this.transports) {
        try {
          console.error(`[Shutdown] Closing transport: ${sessionId}`);
          await transport.close();
        } catch (error) {
          console.error(`[Shutdown] Error closing transport ${sessionId}:`, error);
        }
      }
      this.transports.clear();

      // Close HTTP server
      if (this.httpServer) {
        this.httpServer.close(() => {
          console.error("[Shutdown] HTTP server closed");
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  /**
   * Close the transport manager
   */
  async close(): Promise<void> {
    for (const transport of this.transports.values()) {
      await transport.close();
    }
    this.transports.clear();
    
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer.close(() => resolve());
      });
    }
  }
}
