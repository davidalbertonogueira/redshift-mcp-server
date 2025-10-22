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

# Environment variables
# HTTP_MODE: Set to 'true' to enable HTTP/SSE transport (default: false for STDIO)
# PORT: HTTP server port (default: 3000)
# DATABASE_URL: Required - Redshift connection string
ENV HTTP_MODE=false
ENV PORT=3000

# Health check for HTTP mode
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD if [ "$HTTP_MODE" = "true" ]; then \
        wget --no-verbose --tries=1 --spider http://localhost:$PORT/health || exit 1; \
      else \
        echo "STDIO mode - no health check needed"; \
      fi

# Run the server
CMD ["node", "dist/index.js"]