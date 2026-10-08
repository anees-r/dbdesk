import { getPool, qi, qualified, errorResponse } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const USER_SCHEMAS = `n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp_%'`;

// Column names of a constraint key, as text[] (pg parses text[] into JS arrays).
const keyCols = (keys, rel) =>
  `array(select a.attname::text from unnest(${keys}) with ordinality k(n, o)
           join pg_attribute a on a.attrelid = ${rel} and a.attnum = k.n order by k.o)`;

const FKS = `
  select con.conname as name,
         n1.nspname as schema, c1.relname as table, ${keyCols("con.conkey", "con.conrelid")} as columns,
         n2.nspname as ref_schema, c2.relname as ref_table, ${keyCols("con.confkey", "con.confrelid")} as ref_columns
    from pg_constraint con
    join pg_class c1 on c1.oid = con.conrelid join pg_namespace n1 on n1.oid = c1.relnamespace
    join pg_class c2 on c2.oid = con.confrelid join pg_namespace n2 on n2.oid = c2.relnamespace
   where con.contype = 'f'`;

/**
 * GET /api/schema?server=&db=                  -> overview: every table with columns + foreign keys
 * GET /api/schema?server=&db=&schema=&table=   -> one table: columns, indexes, constraints, references, DDL
 */
export async function GET(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams;
  const client = await getPool(p.get("server"), p.get("db")).connect();
  try {
    await client.query("begin read only");
    const body = p.get("table") ? await tableDetail(client, p.get("schema"), p.get("table")) : await overview(client);
    await client.query("commit");
    return Response.json(body);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return errorResponse(e);
  } finally {
    client.release();
  }
}

async function overview(client) {
  const cols = await client.query(
    `select n.nspname as schema, c.relname as table, c.relkind as kind,
            a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
            not a.attnotnull as nullable, coalesce(a.attnum = any(i.indkey), false) as pk
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       left join pg_index i on i.indrelid = c.oid and i.indisprimary
      where c.relkind in ('r','p','v','m','f') and not c.relispartition and ${USER_SCHEMAS}
      order by n.nspname = 'public' desc, n.nspname, c.relname, a.attnum`
  );
  const fks = await client.query(`${FKS} and ${USER_SCHEMAS.replaceAll("n.", "n1.")}`);

  const tables = new Map();
  for (const r of cols.rows) {
    const key = `${r.schema}.${r.table}`;
    if (!tables.has(key)) tables.set(key, { schema: r.schema, name: r.table, kind: KIND[r.kind], columns: [], fks: [] });
    tables.get(key).columns.push({ name: r.name, type: r.type, nullable: r.nullable, pk: r.pk });
  }
  for (const fk of fks.rows) tables.get(`${fk.schema}.${fk.table}`)?.fks.push(fk);
  return { tables: [...tables.values()] };
}

const KIND = { r: "table", p: "table", v: "view", m: "matview", f: "foreign" };

async function tableDetail(client, schema, table) {
  const rel = await client.query(
    `select c.oid, c.relkind, greatest(c.reltuples, 0)::bigint as estimate,
            pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
            pg_size_pretty(pg_relation_size(c.oid)) as table_size,
            obj_description(c.oid, 'pg_class') as comment,
            case when c.relkind in ('v','m') then pg_get_viewdef(c.oid, true) end as view_def
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relname = $2`,
    [schema, table]
  );
  if (!rel.rows.length) throw new Error(`Table ${schema}.${table} not found`);
  const { oid, relkind, ...info } = rel.rows[0];

  const [columns, indexes, constraints, outgoing, incoming] = await Promise.all([
    client.query(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
              pg_get_expr(d.adbin, d.adrelid) as "default", col_description(a.attrelid, a.attnum) as comment,
              nullif(a.attidentity, '') as identity, a.attgenerated <> '' as generated
         from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped order by a.attnum`,
      [oid]
    ),
    client.query(
      `select ic.relname as name, pg_get_indexdef(i.indexrelid) as def, i.indisunique as unique,
              i.indisprimary as primary, pg_size_pretty(pg_relation_size(i.indexrelid)) as size,
              exists (select 1 from pg_constraint where conindid = i.indexrelid) as from_constraint
         from pg_index i join pg_class ic on ic.oid = i.indexrelid
        where i.indrelid = $1 order by i.indisprimary desc, ic.relname`,
      [oid]
    ),
    client.query(
      `select conname as name, contype as type, pg_get_constraintdef(oid, true) as def, ${keyCols("conkey", "conrelid")} as columns
         from pg_constraint where conrelid = $1 and contype <> 'n' -- PG18 not-null constraints: shown on columns
        order by position(contype::text in 'pufcxt'), conname`,
      [oid]
    ),
    client.query(`${FKS} and con.conrelid = $1`, [oid]),
    client.query(`${FKS} and con.confrelid = $1`, [oid]),
  ]);

  const pk = constraints.rows.find((c) => c.type === "p")?.columns ?? [];
  const fkCols = new Map();
  for (const fk of outgoing.rows) fk.columns.forEach((c, i) => fkCols.set(c, { ...fk, ref_column: fk.ref_columns[i] }));

  return {
    schema, name: table, kind: KIND[relkind], ...info,
    columns: columns.rows.map((c) => ({ ...c, pk: pk.includes(c.name), fk: fkCols.get(c.name) ?? null })),
    indexes: indexes.rows,
    constraints: constraints.rows,
    referencedBy: incoming.rows,
    ddl: ddl(schema, table, relkind, info.view_def, columns.rows, constraints.rows, indexes.rows),
  };
}

function ddl(schema, table, relkind, viewDef, columns, constraints, indexes) {
  const name = qualified(schema, table);
  if (viewDef) return `create ${relkind === "m" ? "materialized " : ""}view ${name} as\n${viewDef.trimEnd()}`;
  const lines = [
    ...columns.map((c) => {
      const extra = c.identity
        ? ` generated ${c.identity === "a" ? "always" : "by default"} as identity`
        : c.generated ? ` generated always as (${c.default}) stored`
        : c.default ? ` default ${c.default}` : "";
      return `  ${qi(c.name)} ${c.type}${c.nullable ? "" : " not null"}${extra}`;
    }),
    ...constraints.map((c) => `  constraint ${qi(c.name)} ${c.def}`),
  ];
  const extra = indexes.filter((i) => !i.from_constraint).map((i) => `${i.def};`);
  return [`create table ${name} (\n${lines.join(",\n")}\n);`, ...extra].join("\n\n");
}
