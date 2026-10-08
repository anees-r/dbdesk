import { getPool, errorResponse } from "@/lib/db";
import { listConnections } from "@/lib/connections";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/databases -> { databases: [{ server, name, database, size }], errors }
// `server` is the connection id. A connection lists just its own database,
// or every database on the server when allDatabases is on.
export async function GET(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const conns = listConnections();
    const results = await Promise.all(
      conns.map(async (c) => {
        try {
          const { rows } = await getPool(c.id).query(
            c.allDatabases
              ? `select datname as database, pg_size_pretty(pg_database_size(datname)) as size
                   from pg_database
                  where not datistemplate and datallowconn and has_database_privilege(datname, 'CONNECT')
                  order by datname`
              : `select current_database() as database, pg_size_pretty(pg_database_size(current_database())) as size`
          );
          return { rows: rows.map((r) => ({ server: c.id, name: c.name, all: c.allDatabases, ...r })) };
        } catch (e) {
          return { error: { server: c.id, name: c.name, error: e.message } };
        }
      })
    );
    return Response.json({
      databases: results.flatMap((r) => r.rows ?? []),
      errors: results.filter((r) => r.error).map((r) => r.error),
    });
  } catch (e) {
    return errorResponse(e, 500);
  }
}
