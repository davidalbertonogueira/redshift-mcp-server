# Redshift MCP Server Docker Image
# Supports both STDIO and HTTP/SSE transport modes
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files for better layer caching
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Build the TypeScript application
RUN npm run build

# Expose port for HTTP/SSE mode
EXPOSE 3000

# Environment variables (with defaults)
# TRANSPORT_MODE: 'stdio' (default) or 'http'
# STATELESS_MODE: 'true' or 'false' (default: false)
# PORT: HTTP server port (default: 3000)
# DATABASE_URL: Required - Redshift connection string
# ENABLE_AUTH: 'true' or 'false' (default: false)
# API_TOKEN: Required if ENABLE_AUTH=true
ENV TRANSPORT_MODE=stdio
ENV STATELESS_MODE=false
ENV PORT=3000

# Health check for HTTP mode
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD if [ "$TRANSPORT_MODE" = "http" ]; then \
        wget --no-verbose --tries=1 --spider http://localhost:$PORT/health || exit 1; \
      else \
        echo "STDIO mode - no health check needed"; \
      fi

# Run the server
CMD ["node", "dist/index.js"]