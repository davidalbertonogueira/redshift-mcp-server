# --- Stage 1: Builder ---
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files for better layer caching
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Build the TypeScript application
RUN npm run build

# The server uses stdio transport, so no port exposure needed
CMD ["node", "dist/index.js"]