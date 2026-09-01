import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedshiftTools } from "../src/core/redshift-tools.js";
import { TEST_DATABASE_URL } from "./db-url.js";

describe("RedshiftTools", () => {
  let tools: RedshiftTools;

  beforeAll(() => {
    tools = new RedshiftTools(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await tools.close();
  });

  describe("query", () => {
    it("runs an arbitrary read-only SQL query", async () => {
      const rows = await tools.query(
        "SELECT client_name FROM clients WHERE client_id = 1"
      );
      expect(rows).toEqual([{ client_name: "Acme Corp" }]);
    });

    it("can join across the sample tables", async () => {
      const rows = await tools.query(`
        SELECT c.client_name, COUNT(*) AS order_count
        FROM public.orders o
        JOIN public.clients c ON c.client_id = o.client_id
        GROUP BY c.client_name
        ORDER BY c.client_name
      `);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty("order_count");
    });

    it("runs inside a read-only transaction, so writes are rejected", async () => {
      await expect(
        tools.query("DELETE FROM clients WHERE client_id = 1")
      ).rejects.toThrow();

      // Confirm nothing was actually removed.
      const rows = await tools.query(
        "SELECT COUNT(*) AS count FROM clients"
      );
      expect(Number(rows[0].count)).toBe(5);
    });
  });

  describe("listSchemas", () => {
    it("lists business schemas and excludes system/shim schemas", async () => {
      const schemas = await tools.listSchemas();
      const names = schemas.map((s) => s.schema_name);

      expect(names).toContain("public");
      expect(names).toContain("marketing");
      expect(names).not.toContain("svv_shim");
      expect(names).not.toContain("pg_catalog");
      expect(names).not.toContain("information_schema");
    });
  });

  describe("listTables", () => {
    it("lists tables in the public schema", async () => {
      const tables = await tools.listTables("public");
      const names = tables.map((t) => t.table_name);

      expect(names).toEqual(
        expect.arrayContaining(["clients", "orders", "order_items"])
      );
    });

    it("lists tables in a non-default schema", async () => {
      const tables = await tools.listTables("marketing");
      expect(tables.map((t) => t.table_name)).toEqual(["campaigns"]);
    });
  });

  describe("getTableSchema", () => {
    it("returns column metadata ordered by position", async () => {
      const columns = await tools.getTableSchema("public", "clients");
      expect(columns.map((c) => c.column_name)).toEqual([
        "client_id",
        "client_name",
        "email",
        "phone",
        "signup_date",
      ]);
      expect(columns[0].is_nullable).toBe("NO");
    });
  });

  describe("describeTable", () => {
    it("bundles columns and statistics for a table", async () => {
      const description = await tools.describeTable("public", "orders");

      expect(description.schema).toBe("public");
      expect(description.table).toBe("orders");
      expect(description.columns.length).toBeGreaterThan(0);
      expect(description.statistics).toHaveLength(1);
      // Like Redshift's own SVV_TABLE_INFO, row_count here is a
      // stats-collector approximation, not a live COUNT(*) — assert
      // shape rather than an exact value.
      expect(Number(description.statistics[0].row_count)).toBeGreaterThan(0);
    });
  });

  describe("findColumn", () => {
    it("finds columns matching a pattern across schemas", async () => {
      const results = await tools.findColumn("email");
      expect(
        results.some(
          (r) => r.table_schema === "public" && r.table_name === "clients"
        )
      ).toBe(true);
    });
  });

  describe("getSampleData", () => {
    it("returns sample rows up to the requested limit", async () => {
      const rows = await tools.getSampleData("public", "clients", 3);
      expect(rows.length).toBe(3);
      expect(rows[0]).toHaveProperty("email");
    });

    it("redacts email/phone fields when requested", async () => {
      const rows = await tools.getSampleData("public", "clients", 5, true);
      expect(rows.length).toBe(5);
      for (const row of rows) {
        expect(row.email).toBe("REDACTED");
        expect(row.phone).toBe("REDACTED");
      }
    });

    it("rejects schema/table names containing unsafe characters", async () => {
      await expect(
        tools.getSampleData("public; DROP TABLE clients;--", "clients")
      ).rejects.toThrow("Invalid input");
    });
  });

  describe("getTableStatistics", () => {
    it("returns row counts and size info for a table", async () => {
      const stats = await tools.getTableStatistics("public", "orders");

      expect(stats).toHaveLength(1);
      expect(stats[0].table_name).toBe("orders");
      expect(Number(stats[0].row_count)).toBeGreaterThan(0);
      expect(Number(stats[0].total_size_mb)).toBeGreaterThanOrEqual(0);
    });
  });
});
