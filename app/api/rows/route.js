import { getPool, getColumns, qi, qualified, RAW_TEXT, errorResponse } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/rows
 *   { action: "insert", server, db, schema, table, values: {col: text|null} }
 *   { action: "update", ..., key: {col: text} | {__ctid: "(0,1)"}, values: {col: text|null} }
 *   { action: "delete", ..., keys: [ {col: text} | {__ctid} , ... ] }
 * Values are sent as text params; Postgres casts them to the column type, so
 * the text you see in the grid round-trips exactly.
 */
export async function POST(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = await req.json();
  const { action, server, db, schema, table } = body;
  const client = await getPool(server, db).connect();
  try {
    const columns = await getColumns(client, schema, table);
    const known = new Set(columns.map((c) => c.name));
    const check = (name) => {
      if (!known.has(name)) throw new Error(`Unknown column "${name}"`);
      return qi(name);
    };
    const target = qualified(schema, table);
    const params = [];
    const param = (v) => (params.push(v), `$${params.length}`);

    const keyClause = (key) => {
      if (!key || !Object.keys(key).length) throw new Error("Missing row key");
      if ("__ctid" in key) return `ctid = ${param(key.__ctid)}::tid`;
      return Object.entries(key)
        .map(([k, v]) => (v === null ? `${check(k)} is null` : `${check(k)} = ${param(v)}`))
        .join(" and ");
    };

    let sql;
    if (action === "insert") {
      const entries = Object.entries(body.values || {});
      sql = entries.length
        ? `insert into ${target} (${entries.map(([k]) => check(k)).join(", ")}) values (${entries
            .map(([, v]) => param(v))
            .join(", ")}) returning *`
        : `insert into ${target} default values returning *`;
    } else if (action === "update") {
      const sets = Object.entries(body.values || {}).map(([k, v]) => `${check(k)} = ${param(v)}`);
      if (!sets.length) throw new Error("Nothing to update");
      sql = `update ${target} set ${sets.join(", ")} where ${keyClause(body.key)} returning *`;
    } else if (action === "delete") {
      const keys = body.keys || [];
      if (!keys.length) throw new Error("No rows selected");
      sql = `delete from ${target} where ${keys.map((k) => `(${keyClause(k)})`).join(" or ")}`;
    } else {
      throw new Error(`Unknown action "${action}"`);
    }

    await client.query("begin");
    const res = await client.query({ text: sql, values: params, types: RAW_TEXT });
    const expected = action === "delete" ? body.keys.length : 1;
    if (action !== "insert" && res.rowCount !== expected) {
      throw new Error(`Expected to affect ${expected} row(s) but matched ${res.rowCount}; rolled back.`);
    }
    await client.query("commit");
    return Response.json({ rowCount: res.rowCount, rows: res.rows, sql });
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return errorResponse(e);
  } finally {
    client.release();
  }
}
