-- Compatibility shim so this project's Redshift-specific catalog queries
-- (SVV_COLUMNS, SVV_TABLES, SVV_TABLE_INFO, pg_attribute.attisdistkey/attsortkeyord)
-- run unmodified against plain Postgres.
--
-- The schema name starts with "svv", which is one of the prefixes the
-- application's own listSchemas() query already excludes (alongside pg_%,
-- stl%, stv%, svl%), so this schema stays invisible to the app just like
-- Redshift's real system schemas do.

CREATE SCHEMA svv_shim;

-- Real pg_attribute has an `attmissingval` column of pseudo-type `anyarray`,
-- which cannot appear in a view, so an explicit column list is required
-- (attmissingval isn't something the app queries anyway).
CREATE VIEW svv_shim.pg_attribute AS
SELECT
    attrelid, attname, atttypid, attstattarget, attlen, attnum, attndims,
    attcacheoff, atttypmod, attbyval, attstorage, attalign, attnotnull,
    atthasdef, atthasmissing, attidentity, attgenerated, attisdropped,
    attislocal, attinhcount, attcollation, attacl, attoptions, attfdwoptions,
    false       AS attisdistkey,
    0::int2     AS attsortkeyord
FROM pg_catalog.pg_attribute;

CREATE VIEW svv_shim.pg_class AS
SELECT * FROM pg_catalog.pg_class;

CREATE VIEW svv_shim.svv_columns AS
SELECT
    table_schema,
    table_name,
    column_name,
    data_type,
    character_maximum_length,
    numeric_precision,
    numeric_scale,
    is_nullable,
    column_default,
    ordinal_position
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'svv_shim');

CREATE VIEW svv_shim.svv_tables AS
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'svv_shim')
  AND table_type = 'BASE TABLE';

-- Redshift's SVV_TABLE_INFO carries cluster-level stats (disk encoding,
-- distribution style, etc.) that have no Postgres equivalent; those columns
-- are stubbed with fixed values so the query shape matches, while size and
-- row-count come from real Postgres catalogs.
CREATE VIEW svv_shim.svv_table_info AS
SELECT
    current_database()::text                                          AS database,
    n.nspname::text                                                   AS schema,
    c.relname::text                                                   AS "table",
    c.oid::int                                                        AS table_id,
    ROUND((pg_catalog.pg_total_relation_size(c.oid) / 1024.0 / 1024.0)::numeric, 2)
                                                                       AS size,
    ROUND((100.0 * pg_catalog.pg_total_relation_size(c.oid)
        / GREATEST(pg_catalog.pg_database_size(current_database()), 1))::numeric, 4)
                                                                       AS pct_used,
    COALESCE(s.n_live_tup, 0)::bigint                                 AS tbl_rows,
    true                                                               AS encoded,
    'EVEN'::text                                                       AS diststyle,
    ''::text                                                           AS sortkey1,
    0                                                                  AS max_varchar,
    COALESCE(s.last_analyze, s.last_autoanalyze, now())::text         AS create_time
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'svv_shim');

-- Put svv_shim ahead of pg_catalog so unqualified `pg_class`/`pg_attribute`
-- references (as used by this project's queries) resolve to the shimmed
-- views above instead of the real system catalogs.
ALTER DATABASE analytics SET search_path TO "$user", public, svv_shim, pg_catalog;
