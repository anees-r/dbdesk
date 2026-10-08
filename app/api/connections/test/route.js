import pg from "pg";
import { errorResponse } from "@/lib/db";
import { draftConfig } from "@/lib/connections";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/connections/test { id?, host, port, database, user, password?, ssl }
// Opens one connection with the form's values and reports the server version.
export async function POST(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const started = performance.now();
  let client;
  try {
    client = new pg.Client({ ...draftConfig(await req.json()), connectionTimeoutMillis: 8000 });
    await client.connect();
    const { rows } = await client.query("select current_setting('server_version') as version, current_user as user");
    return Response.json({ ok: true, ...rows[0], ms: Math.round(performance.now() - started) });
  } catch (e) {
    return errorResponse(e);
  } finally {
    await client?.end().catch(() => {});
  }
}
