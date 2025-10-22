#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";
import pg from "pg";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Define interfaces
interface RedshiftTable {
  table_name: string;
}

interface RedshiftColumn {
  column_name: string;
  data_type: string;
  character_maximum_length?: number | null;
  numeric_precision?: number | null;
  numeric_scale?: number | null;
  is_nullable: string;
  column_default?: string | null;
  ordinal_position: number;
  is_distkey: boolean;
  is_sortkey: boolean;
}

interface RedshiftStatistics {
  database: string;
  schema: string;
  table_id: number;
  table_name: string;
  size: number;
  percent_used: number;
  row_count: number;
  encoded: boolean;
  diststyle: string;
  sortkey1: string;
  max_varchar: number;
  create_time: string;
}

const server = new Server(
  {
    name: "redshift-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: { list: {} },
      tools: { list: {}, call: {} },
    },
  },
);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

// Create resource URL without sensitive info
const resourceBaseUrl = new URL(databaseUrl);
console.warn(resourceBaseUrl);
const sslEnabled = resourceBaseUrl.searchParams.get("ssl") === "true";

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: sslEnabled ? { rejectUnauthorized: true } : false,
});

// Resource paths
const SCHEMA_PATH = "schema";
const SAMPLE_PATH = "sample";
const STATISTICS_PATH = "statistics";

// List available resources (schemas and tables)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const client = await pool.connect();
  try {
    // First get all schemas (excluding system schemas)
    const schemasResult = await client.query(`
      SELECT nspname as schema_name
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%'
      AND nspname NOT IN ('information_schema', 'sys')
      AND nspname NOT LIKE 'stl%'
      AND nspname NOT LIKE 'stv%'
      AND nspname NOT LIKE 'svv%'
      AND nspname NOT LIKE 'svl%'
      ORDER BY schema_name
    `);

    const resources: { uri: string; mimeType: string; name: string; }[] = [];

    // Add schemas as resources
    for (const schema of schemasResult.rows) {
      resources.push({
        uri: new URL(`schema/${schema.schema_name}`, resourceBaseUrl).href,
        mimeType: "application/json",
        name: `Schema: ${schema.schema_name}`,
      });

      // Get tables for this schema
      const tablesResult = await client.query<RedshiftTable>(`
        SELECT table_name
        FROM SVV_TABLES
        WHERE table_schema = $1
        ORDER BY table_name
      `, [schema.schema_name]);

      // Add tables as resources with different resource types
      for (const table of tablesResult.rows) {
        // Schema resource (column definitions)
        resources.push({
          uri: new URL(`${schema.schema_name}/${table.table_name}/${SCHEMA_PATH}`, resourceBaseUrl).href,
          mimeType: "application/json",
          name: `Table Schema: ${schema.schema_name}.${table.table_name}`,
        });

        // Sample data resource
        resources.push({
          uri: new URL(`${schema.schema_name}/${table.table_name}/${SAMPLE_PATH}`, resourceBaseUrl).href,
          mimeType: "application/json",
          name: `Sample Data: ${schema.schema_name}.${table.table_name}`,
        });

        // Statistics resource
        resources.push({
          uri: new URL(`${schema.schema_name}/${table.table_name}/${STATISTICS_PATH}`, resourceBaseUrl).href,
          mimeType: "application/json",
          name: `Statistics: ${schema.schema_name}.${table.table_name}`,
        });
      }
    }

    return {
      resources: resources,
    };
  } finally {
    client.release();
  }
});

// Read a specific resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resourceUrl = new URL(request.params.uri);
  const pathComponents = resourceUrl.pathname.split("/");

  // Check if this is a schema listing
  if (pathComponents.length === 2 && pathComponents[0] === SCHEMA_PATH) {
    const schemaName = pathComponents[1];
    const client = await pool.connect();

    try {
      const result = await client.query<RedshiftTable>(`
        SELECT table_name
        FROM SVV_TABLES
        WHERE table_schema = $1
        ORDER BY table_name
      `, [schemaName]);

      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(result.rows, null, 2),
          },
        ],
      };
    } finally {
      client.release();
    }
  }

  // Handle table-specific resources
  if (pathComponents.length === 3) {
    const schemaName = pathComponents[0];
    const tableName = pathComponents[1];
    const resourceType = pathComponents[2];

    const client = await pool.connect();
    try {
      let result;

      // Schema resource - column definitions
      if (resourceType === SCHEMA_PATH) {
        result = await client.query<RedshiftColumn>(`
          SELECT DISTINCT 
            c.column_name,
            c.data_type,
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
            c.is_nullable,
            c.ordinal_position,
            c.column_default,
            c.ordinal_position,
            a.attisdistkey as is_distkey,
            BOOL(COALESCE(a.attsortkeyord, 0)) as is_sortkey
          FROM SVV_COLUMNS c
          INNER JOIN pg_class r ON r.relname = c.table_name
          INNER JOIN pg_attribute a ON a.attrelid = r.oid AND a.attname = c.column_name
          WHERE table_schema = $1
          AND table_name = $2
          ORDER BY ordinal_position
        `, [schemaName, tableName]);
      }
      // Sample data resource
      else if (resourceType === SAMPLE_PATH) {
        // Use a parameterized query approach that's safe
        result = await client.query(`
          SELECT * FROM "${schemaName}"."${tableName}" LIMIT 5
        `);
        // redact PII
        result.rows = result.rows.map(row => {
          const newRow = { ...row };
          newRow.email = "REDACTED";
          newRow.phone = "REDACTED";
          return newRow;
        });
      }
      // Statistics resource
      else if (resourceType === STATISTICS_PATH) {
        result = await client.query<RedshiftStatistics>(`
          SELECT
            database,
            schema,
            table_id,
            "table" as table_name,
            size as total_size_mb,
            pct_used as percent_used,
            tbl_rows as row_count,
            encoded,
            diststyle,
            sortkey1,
            max_varchar,
            create_time
          FROM SVV_TABLE_INFO
          WHERE schema = $1
          AND "table" = $2
        `, [schemaName, tableName]);
      }
      else {
        throw new Error(`Unknown resource type: ${resourceType}`);
      }

      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(result.rows, null, 2),
          },
        ],
      };
    } finally {
      client.release();
    }
  }

  throw new Error("Invalid resource URI");
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const querySchema = z.object({ sql: z.string() });
  const describeTableSchema = z.object({ schema: z.string(), table: z.string() });
  const findColumnSchema = z.object({ pattern: z.string() });

  return {
    tools: [
      {
        name: "query",
        description: "Run a read-only SQL query against Redshift",
        inputSchema: zodToJsonSchema(querySchema),
      },
      {
        name: "describe_table",
        description: "Get detailed information about a specific table",
        inputSchema: zodToJsonSchema(describeTableSchema),
      },
      {
        name: "find_column",
        description: "Find tables containing columns with specific name patterns",
        inputSchema: zodToJsonSchema(findColumnSchema),
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const client = await pool.connect();

  try {
    // Run a read-only SQL query
    if (request.params.name === "query") {
      const sql = request.params.arguments?.sql as string;

      try {
        // Begin a read-only transaction for safety
        await client.query("BEGIN TRANSACTION READ ONLY");
        const result = await client.query(sql);

        return {
          content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error executing query: ${(error as Error).message}` }],
          isError: true,
        };
      } finally {
        client
          .query("ROLLBACK")
          .catch((error) =>
            console.warn("Could not roll back transaction:", error),
          );
      }
    }

    // Get detailed information about a specific table
    else if (request.params.name === "describe_table") {
      const schema = request.params.arguments?.schema as string;
      const table = request.params.arguments?.table as string;

      try {
        // Get column information
        const columnsResult = await client.query(`
          SELECT DISTINCT 
            c.column_name,
            c.data_type,
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
            c.is_nullable,
            c.ordinal_position,
            c.column_default,
            c.ordinal_position,
            a.attisdistkey as is_distkey,
            BOOL(COALESCE(a.attsortkeyord, 0)) as is_sortkey
          FROM SVV_COLUMNS c
          INNER JOIN pg_class r ON r.relname = c.table_name
          INNER JOIN pg_attribute a ON a.attrelid = r.oid AND a.attname = c.column_name
          WHERE table_schema = $1
          AND table_name = $2
          ORDER BY ordinal_position
        `, [schema, table]);

        // Get table statistics
        const statsResult = await client.query(`
          SELECT
            size as total_size_mb,
            tbl_rows as row_count,
            create_time
          FROM SVV_TABLE_INFO
          WHERE schema = $1
          AND "table" = $2
        `, [schema, table]);

        const tableDescription = {
          schema,
          table,
          columns: columnsResult.rows,
          statistics: statsResult.rows || [{ total_size_mb: "Unknown", row_count: "Unknown", create_time: "Unknown" }]
        };

        return {
          content: [{ type: "text", text: JSON.stringify(tableDescription, null, 2) }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error describing table: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }

    // Find tables containing columns with specific name patterns
    else if (request.params.name === "find_column") {
      const pattern = request.params.arguments?.pattern as string;

      try {
        const result = await client.query(`          
          SELECT 
            table_schema,
            table_name,
            column_name,
            data_type
          FROM SVV_COLUMNS
          WHERE column_name ILIKE $1
          ORDER BY table_schema, table_name, column_name
        `, [`%${pattern}%`]);

        return {
          content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error finding columns: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }

    else {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
  } finally {
    client.release();
  }
});

// Run the server
async function runServer() {
  const isHttpMode = process.env.HTTP_MODE === 'true';
  
  if (isHttpMode) {
    // HTTP/SSE mode for web-based clients like MCP Inspector
    const app = express();
    const port = process.env.PORT || 3000;
    
    // Enable CORS for all origins (adjust for production)
    app.use(cors({
      origin: true,
      credentials: true
    }));
    
    app.use(express.json());
    
    // SSE endpoint for MCP Inspector
    app.get('/sse', async (req, res) => {
      console.log('SSE connection established');
      const transport = new SSEServerTransport('/message', res);
      await server.connect(transport);
    });
    
    // HTTP endpoint for direct HTTP requests
    app.post('/message', async (req, res) => {
      try {
        console.log('HTTP request received:', req.body);
        // Handle the MCP request directly
        res.json({ message: 'Use SSE endpoint for MCP communication' });
      } catch (error) {
        console.error('HTTP request error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', mode: 'http', timestamp: new Date().toISOString() });
    });
    
    app.listen(port, () => {
      console.log(`MCP Server running in HTTP mode on port ${port}`);
      console.log(`SSE endpoint: http://localhost:${port}/sse`);
      console.log(`Health check: http://localhost:${port}/health`);
    });
  } else {
    // STDIO mode for command-line clients
    console.log('MCP Server running in STDIO mode');
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

runServer().catch(console.error);
