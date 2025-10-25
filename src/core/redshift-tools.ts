import pg from "pg";

// Define interfaces
export interface RedshiftTable {
  table_name: string;
}

export interface RedshiftSchema {
  schema_name: string;
}

export interface RedshiftColumn {
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

export interface RedshiftStatistics {
  database: string;
  schema: string;
  table_id: number;
  table_name: string;
  total_size_mb: number;
  percent_used: number;
  row_count: number;
  encoded: boolean;
  diststyle: string;
  sortkey1: string;
  max_varchar: number;
  create_time: string;
}

export interface TableDescription {
  schema: string;
  table: string;
  columns: RedshiftColumn[];
  statistics: Array<{
    total_size_mb: number | string;
    row_count: number | string;
    create_time: string;
  }>;
}

export interface ColumnSearchResult {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
}

/**
 * Core business logic for Redshift operations.
 * Pure functions with no transport/MCP awareness.
 */
export class RedshiftTools {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    const url = new URL(databaseUrl);
    const sslEnabled = url.searchParams.get("ssl") === "true";

    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: sslEnabled ? { rejectUnauthorized: true } : false,
    });
  }

  /**
   * Execute a read-only SQL query
   */
  async query(sql: string): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(sql);
      return result.rows;
    } finally {
      await client.query("ROLLBACK").catch((error) =>
        console.error("Could not roll back transaction:", error)
      );
      client.release();
    }
  }

  /**
   * Get detailed information about a specific table
   */
  async describeTable(schema: string, table: string): Promise<TableDescription> {
    const client = await this.pool.connect();
    try {
      // Get column information
      const columnsResult = await client.query<RedshiftColumn>(`
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

      return {
        schema,
        table,
        columns: columnsResult.rows,
        statistics: statsResult.rows.length > 0
          ? statsResult.rows
          : [{ total_size_mb: "Unknown", row_count: "Unknown", create_time: "Unknown" }]
      };
    } finally {
      client.release();
    }
  }

  /**
   * Find tables containing columns with specific name patterns
   */
  async findColumn(pattern: string): Promise<ColumnSearchResult[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<ColumnSearchResult>(`          
        SELECT 
          table_schema,
          table_name,
          column_name,
          data_type
        FROM SVV_COLUMNS
        WHERE column_name ILIKE $1
        ORDER BY table_schema, table_name, column_name
      `, [`%${pattern}%`]);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * List all schemas (excluding system schemas)
   */
  async listSchemas(): Promise<RedshiftSchema[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<RedshiftSchema>(`
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
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * List all tables in a specific schema
   */
  async listTables(schema: string): Promise<RedshiftTable[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<RedshiftTable>(`
        SELECT table_name
        FROM SVV_TABLES
        WHERE table_schema = $1
        ORDER BY table_name
      `, [schema]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get column definitions for a table
   */
  async getTableSchema(schema: string, table: string): Promise<RedshiftColumn[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<RedshiftColumn>(`
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
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get sample data from a table with optional PII redaction
   */
  async getSampleData(schema: string, table: string, limit: number = 5, redactPII: boolean = false): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT * FROM "${schema}"."${table}" LIMIT ${limit}
      `);
      
      // Optionally redact PII fields
      if (redactPII) {
        return result.rows.map(row => {
          const newRow = { ...row };
          if ('email' in newRow) newRow.email = "REDACTED";
          if ('phone' in newRow) newRow.phone = "REDACTED";
          return newRow;
        });
      }
      
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get table statistics
   */
  async getTableStatistics(schema: string, table: string): Promise<RedshiftStatistics[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<RedshiftStatistics>(`
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
      `, [schema, table]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
