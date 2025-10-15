#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import { z } from "zod";

// Define interfaces
interface RedshiftTable {
  table_name: string;
}

const server = new McpServer({
  name: "redshift-mcp-server",
  version: "0.1.0",
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

const sslEnabled = new URL(databaseUrl).searchParams.get("ssl") === "true";

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: sslEnabled ? { rejectUnauthorized: true } : false,
});

// Tool: Run a read-only SQL query
server.registerTool(
  "query",
  {
    description: "Run a read-only SQL query against Redshift",
    inputSchema: {
      sql: z.string(),
    },
  },
  async ({ sql }) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
      };
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
);

// Tool: Get detailed information about a specific table
server.registerTool(
  "describe_table",
  {
    description: "Get detailed information about a specific table",
    inputSchema: {
      schema: z.string(),
      table: z.string(),
    },
  },
  async ({ schema, table }) => {
    const client = await pool.connect();
    try {
      const columnsResult = await client.query(
        `
        SELECT DISTINCT 
          c.column_name,
          c.data_type,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          c.is_nullable,
          c.ordinal_position,
          c.column_default,
          a.attisdistkey as is_distkey,
          CAST(COALESCE(a.attsortkeyord, 0) AS BIT)::BOOLEAN as is_sortkey
        FROM SVV_COLUMNS c
        INNER JOIN pg_class r ON r.relname = c.table_name
        INNER JOIN pg_attribute a ON a.attrelid = r.oid AND a.attname = c.column_name
        WHERE table_schema = $1
        AND table_name = $2
        ORDER BY c.ordinal_position
      `,
        [schema, table]
      );

      const statsResult = await client.query(
        `
        SELECT
          size as total_size_mb,
          tbl_rows as row_count,
          create_time
        FROM SVV_TABLE_INFO
        WHERE schema = $1
        AND "table" = $2
      `,
        [schema, table]
      );

      const tableDescription = {
        schema,
        table,
        columns: columnsResult.rows,
        statistics:
          statsResult.rows[0] ||
          {
            total_size_mb: "Unknown",
            row_count: "Unknown",
            create_time: "Unknown",
          },
      };

      return {
        content: [
          { type: "text", text: JSON.stringify(tableDescription, null, 2) },
        ],
      };
    } finally {
      client.release();
    }
  }
);

// Tool: Find tables containing columns with specific name patterns
server.registerTool(
  "find_column",
  {
    description: "Find tables containing columns with specific name patterns",
    inputSchema: {
      pattern: z.string(),
    },
  },
  async ({ pattern }) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `          
        SELECT 
          table_schema,
          table_name,
          column_name,
          data_type
        FROM SVV_COLUMNS
        WHERE column_name ILIKE $1
        ORDER BY table_schema, table_name, column_name
      `,
        [`%${pattern}%`]
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
      };
    } finally {
      client.release();
    }
  }
);

// Run the server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);
