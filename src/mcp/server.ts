import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { RedshiftTools } from "../core/redshift-tools.js";

export interface RedshiftMcpServerConfig {
  databaseUrl: string;
  redactPII?: boolean;
}

/**
 * Creates an MCP server instance configured for Redshift access.
 * This server is transport-agnostic and can work with any MCP transport.
 */
export function createRedshiftMcpServer(config: string | RedshiftMcpServerConfig): Server {
  // Support both old string format and new config object format
  const databaseUrl = typeof config === 'string' ? config : config.databaseUrl;
  const redactPII = typeof config === 'string' ? false : (config.redactPII ?? false);
  // Initialize the core business logic
  const tools = new RedshiftTools(databaseUrl);
  
  // Create resource URL for resource URIs (without sensitive info)
  const resourceBaseUrl = new URL(databaseUrl);
  
  // Create MCP server with capabilities
  const server = new Server(
    {
      name: "redshift-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        logging: {},
      },
    }
  );

  // ==================== TOOLS ====================

  /**
   * List available tools
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const querySchema = z.object({ 
      sql: z.string().describe("SQL query to execute (SELECT statements only)") 
    });
    const describeTableSchema = z.object({ 
      schema: z.string().describe("Schema name"), 
      table: z.string().describe("Table name") 
    });
    const findColumnSchema = z.object({ 
      pattern: z.string().describe("Column name pattern to search for (supports wildcards)") 
    });

    return {
      tools: [
        {
          name: "query",
          description: "Run a read-only SQL query against Redshift",
          inputSchema: zodToJsonSchema(querySchema),
        },
        {
          name: "describe_table",
          description: "Get detailed information about a specific table including columns and statistics",
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

  /**
   * Handle tool calls
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;

    try {
      // Tool: query
      if (toolName === "query") {
        const sql = request.params.arguments?.sql as string;
        const result = await tools.query(sql);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Tool: describe_table
      if (toolName === "describe_table") {
        const schema = request.params.arguments?.schema as string;
        const table = request.params.arguments?.table as string;
        const result = await tools.describeTable(schema, table);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Tool: find_column
      if (toolName === "find_column") {
        const pattern = request.params.arguments?.pattern as string;
        const result = await tools.findColumn(pattern);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${toolName}`,
          },
        ],
        isError: true,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool ${toolName}: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // ==================== RESOURCES ====================

  /**
   * List available resources
   */
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      const schemas = await tools.listSchemas();
      const resources: Array<{ uri: string; mimeType: string; name: string }> = [];

      // Add each schema as a resource
      for (const schema of schemas) {
        resources.push({
          uri: new URL(`schema/${schema.schema_name}`, resourceBaseUrl).href,
          mimeType: "application/json",
          name: `Schema: ${schema.schema_name}`,
        });

        // Get tables for this schema
        const tables = await tools.listTables(schema.schema_name);

        // Add table resources (schema, sample, statistics)
        for (const table of tables) {
          const schemaName = schema.schema_name;
          const tableName = table.table_name;

          // Table schema resource
          resources.push({
            uri: new URL(`${schemaName}/${tableName}/schema`, resourceBaseUrl).href,
            mimeType: "application/json",
            name: `Table Schema: ${schemaName}.${tableName}`,
          });

          // Sample data resource
          resources.push({
            uri: new URL(`${schemaName}/${tableName}/sample`, resourceBaseUrl).href,
            mimeType: "application/json",
            name: `Sample Data: ${schemaName}.${tableName}`,
          });

          // Statistics resource
          resources.push({
            uri: new URL(`${schemaName}/${tableName}/statistics`, resourceBaseUrl).href,
            mimeType: "application/json",
            name: `Statistics: ${schemaName}.${tableName}`,
          });
        }
      }

      return {
        resources,
      };
    } catch (error) {
      console.error("Error listing resources:", error);
      return {
        resources: [],
      };
    }
  });

  /**
   * Read a specific resource
   */
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resourceUrl = new URL(request.params.uri);
    const pathComponents = resourceUrl.pathname.split("/").filter(p => p);

    try {
      // Schema listing: /schema/{schemaName}
      if (pathComponents.length === 2 && pathComponents[0] === "schema") {
        const schemaName = pathComponents[1];
        const tables = await tools.listTables(schemaName);
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: "application/json",
              text: JSON.stringify(tables, null, 2),
            },
          ],
        };
      }

      // Table resources: /{schema}/{table}/{type}
      if (pathComponents.length === 3) {
        const [schemaName, tableName, resourceType] = pathComponents;

        if (resourceType === "schema") {
          const columns = await tools.getTableSchema(schemaName, tableName);
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(columns, null, 2),
              },
            ],
          };
        }

        if (resourceType === "sample") {
          const sampleData = await tools.getSampleData(schemaName, tableName, 5, redactPII);
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(sampleData, null, 2),
              },
            ],
          };
        }

        if (resourceType === "statistics") {
          const stats = await tools.getTableStatistics(schemaName, tableName);
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(stats, null, 2),
              },
            ],
          };
        }

        throw new Error(`Unknown resource type: ${resourceType}`);
      }

      throw new Error("Invalid resource URI");
    } catch (error) {
      throw new Error(`Error reading resource: ${(error as Error).message}`);
    }
  });

  return server;
}
