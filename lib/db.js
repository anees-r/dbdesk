import pg from "pg";

const { Pool } = pg;

// Return every value as Postgres' own text representation.
// That's what a DB client wants: exact display (numeric, bigint, timestamps,
// arrays, bytea) and lossless round-trips when you edit a cell.
export const RAW_TEXT = { getTypeParser: () => (v) => v };

/**
 * Servers come from env:
 *   DATABASE_SERVERS='[{"name":"home","url":"postgres://user:pass@host:5432/postgres"}]'
 * or a single DATABASE_URL (shown as "default").
 * Every non-template database on each server shows up in the dropdown.
 */
function servers() {
  if (process.env.DATABASE_SERVERS) return JSON.parse(process.env.DATABASE_SERVERS);
  if (process.env.DATABASE_URL) return [{ name: "default", url: process.env.DATABASE_URL }];
  return [];
}

export function listServers() {
  return servers().map((s) => s.name);
}

const pools = (globalThis.__dbdeskPools ??= new Map());

export function getPool(serverName, database) {
  const key = `${serverName}/${database ?? ""}`;
  let pool = pools.get(key);
  if (!pool) {
    const server = servers().find((s) => s.name === serverName);
    if (!server) throw new Error(`Unknown server "${serverName}"`);
    const url = new URL(server.url);
    if (database) url.pathname = "/" + encodeURIComponent(database);
    pool = new Pool({ connectionString: url.toString(), max: 4, idleTimeoutMillis: 60_000 });
    pool.on("error", (err) => console.error(`[pool ${key}]`, err.message));
    pools.set(key, pool);
  }
  return pool;
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
