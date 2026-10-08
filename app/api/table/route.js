import { getPool, getColumns, qi, qualified, RAW_TEXT, errorResponse } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/table?server=&db=&schema=&table=&page=1&pageSize=100&sort=col&dir=asc&where=
 * `where` is a raw SQL predicate typed by you in the filter box (this is a
 * private, full-access client, so that's intentional).
 */
export async function GET(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams;
  const schema = p.get("schema");
  const table = p.get("table");
  const page = Math.max(1, Number(p.get("page")) || 1);
  const pageSize = Math.min(1000, Math.max(1, Number(p.get("pageSize")) || 100));
  const where = (p.get("where") || "").trim();

  const client = await getPool(p.get("server"), p.get("db")).connect();
  try {
    const columns = await getColumns(client, schema, table);
    const relkind = columns[0].relkind;
    const isTable = relkind === "r" || relkind === "p";
    const pk = columns.filter((c) => c.pk).map((c) => c.name);

    const sortCol = columns.find((c) => c.name === p.get("sort"))?.name;
    const dir = p.get("dir") === "desc" ? "desc" : "asc";
    const orderBy = sortCol
      ? `order by ${qi(sortCol)} ${dir} nulls last`
      : pk.length
      ? `order by ${pk.map(qi).join(", ")}`
      : "";
    const whereSql = where ? `where ${where}` : "";
    // No primary key -> fall back to ctid so rows can still be edited/deleted.
    const ctid = isTable && !pk.length ? ", ctid::text as __ctid" : "";

    await client.query("begin read only");
    const data = await client.query({
      text: `select *${ctid} from ${qualified(schema, table)} ${whereSql} ${orderBy} limit ${pageSize} offset ${(page - 1) * pageSize}`,
      rowMode: "array",
      types: RAW_TEXT,
    });

    // Exact count for small tables / filtered queries, planner estimate for huge ones.
    let total, exact = true;
    const est = await client.query(
      `select greatest(c.reltuples, 0)::bigint as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2`,
      [schema, table]
    );
    const estimate = Number(est.rows[0]?.n ?? 0);
    if (!where && estimate > 500_000) {
      total = estimate;
      exact = false;
    } else {
      const c = await client.query(`select count(*)::bigint as n from ${qualified(schema, table)} ${whereSql}`);
      total = Number(c.rows[0].n);
    }
    await client.query("commit");

    return Response.json({
      columns: columns.map(({ relkind, ...c }) => c),
      pk,
      editable: isTable,
      keyMode: pk.length ? "pk" : isTable ? "ctid" : "none",
      rows: data.rows,
      total,
      exact,
      page,
      pageSize,
    });
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return errorResponse(e);
  } finally {
    client.release();
  }
}
