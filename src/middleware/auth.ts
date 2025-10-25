import { Request, Response, NextFunction } from "express";

export interface AuthConfig {
  token: string;
}

/**
 * Simple Bearer token authentication middleware.
 * For production deployments (e.g., Kubernetes + Dust.tt).
 * 
 * Future: This can be extended to support OAuth using MCP SDK's auth module.
 */
export function createAuthMiddleware(config: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health/ready endpoints
    if (req.path === "/health" || req.path === "/ready") {
      return next();
    }

    // Skip auth for OPTIONS requests (CORS preflight)
    if (req.method === "OPTIONS") {
      return next();
    }

    // Skip auth for OAuth discovery endpoints (let them 404, which tells clients OAuth is not available)
    if (req.path.startsWith("/.well-known/") || req.path === "/register") {
      return next();
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Missing Authorization header",
        },
        id: null,
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    
    if (token !== config.token) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Invalid authorization token",
        },
        id: null,
      });
    }

    next();
  };
}
