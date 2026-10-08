import { listServers, getPool, errorResponse } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/databases -> [{ server, database, size }]
export async function GET(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const out = [];
    const errors = [];
    for (const server of listServers()) {
      try {
        const { rows } = await getPool(server).query(
          `select datname as database, pg_size_pretty(pg_database_size(datname)) as size
             from pg_database
            where not datistemplate and datallowconn
            order by datname`
        );
        for (const r of rows) out.push({ server, ...r });
      } catch (e) {
        errors.push({ server, error: e.message });
      }
    }
    return Response.json({ databases: out, errors });
  } catch (e) {
    return errorResponse(e, 500);
  }
}
