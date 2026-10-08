import { getPool, errorResponse } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/tables?server=&db= -> tables, views, matviews (excluding system schemas)
export async function GET(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams;
  try {
    const { rows } = await getPool(p.get("server"), p.get("db")).query(
      `select n.nspname as schema, c.relname as name,
              case c.relkind when 'r' then 'table' when 'p' then 'table'
                             when 'v' then 'view' when 'm' then 'matview'
                             when 'f' then 'foreign' end as kind,
              greatest(c.reltuples, 0)::bigint as estimate
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r','p','v','m','f')
          and not c.relispartition
          and n.nspname not in ('pg_catalog','information_schema','pg_toast')
          and n.nspname not like 'pg_temp_%'
        order by n.nspname = 'public' desc, n.nspname, c.relname`
    );
    return Response.json({ tables: rows });
  } catch (e) {
    return errorResponse(e);
  }
}
