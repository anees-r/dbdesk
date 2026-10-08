import pg from "pg";
import { connectionConfig } from "./connections";

const { Pool } = pg;

// Return every value as Postgres' own text representation.
// That's what a DB client wants: exact display (numeric, bigint, timestamps,
// arrays, bytea) and lossless round-trips when you edit a cell.
export const RAW_TEXT = { getTypeParser: () => (v) => v };

const pools = (globalThis.__dbdeskPools ??= new Map());

/** Pool per connection id + database. Connections live in lib/connections.js. */
export function getPool(connectionId, database) {
  const key = `${connectionId}/${database ?? ""}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = new Pool({ ...connectionConfig(connectionId, database), max: 4, idleTimeoutMillis: 60_000 });
    pool.on("error", (err) => console.error(`[pool ${key}]`, err.message));
    pools.set(key, pool);
  }
  return pool;
}

/** Drop pools for a connection after it's edited or deleted. */
export function closePools(connectionId) {
  for (const [key, pool] of pools) {
    if (key.startsWith(`${connectionId}/`)) {
      pools.delete(key);
      pool.end().catch(() => {});
    }
  }
}

/** Quote an identifier: my "table" -> "my ""table""" */
export const qi = (name) => '"' + String(name).replace(/"/g, '""') + '"';

export const qualified = (schema, table) => `${qi(schema)}.${qi(table)}`;

/** Column metadata for a table/view, including primary key membership. */
export async function getColumns(client, schema, table) {
  const { rows } = await client.query(
    `select a.attname as name,
            format_type(a.atttypid, a.atttypmod) as type,
            not a.attnotnull as nullable,
            pg_get_expr(d.adbin, d.adrelid) as "default",
            coalesce(a.attnum = any(i.indkey), false) as pk,
            c.relkind
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       left join pg_index i on i.indrelid = c.oid and i.indisprimary
      where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [schema, table]
  );
  if (!rows.length) throw new Error(`Table ${schema}.${table} not found`);
  return rows;
}

export function errorResponse(err, status = 400) {
  return Response.json(
    {
      error: err.message,
      detail: err.detail,
      hint: err.hint,
      position: err.position,
      code: err.code,
    },
    { status }
  );
}
