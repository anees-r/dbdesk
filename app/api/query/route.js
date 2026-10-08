import { getPool, RAW_TEXT, errorResponse } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/query { server, db, sql }
 * Runs arbitrary SQL (multiple statements allowed). Full read/write.
 * Returns one result per statement.
 */
export async function POST(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { server, db, sql } = await req.json();
  if (!sql?.trim()) return errorResponse(new Error("Empty query"));

  const client = await getPool(server, db).connect();
  const started = performance.now();
  try {
    const timeout = Number(process.env.STATEMENT_TIMEOUT_MS) || 60_000;
    await client.query(`set statement_timeout = ${timeout}`);
    const res = await client.query({ text: sql, rowMode: "array", types: RAW_TEXT });
    const results = (Array.isArray(res) ? res : [res]).map((r) => ({
      command: r.command,
      rowCount: r.rowCount,
      columns: (r.fields || []).map((f) => f.name),
      rows: r.rows || [],
    }));
    return Response.json({ results, ms: Math.round(performance.now() - started) });
  } catch (e) {
    return errorResponse(e);
  } finally {
    await client.query("reset statement_timeout").catch(() => {});
    client.release();
  }
}
