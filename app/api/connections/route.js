import { closePools, errorResponse } from "@/lib/db";
import { listConnections, createConnection, updateConnection, deleteConnection } from "@/lib/connections";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET    /api/connections                 -> { connections } (no passwords)
 * POST   /api/connections { name, host, port, database, user, password, ssl, allDatabases }
 * PUT    /api/connections { id, ...same }  omit `password` to keep the stored one
 * DELETE /api/connections?id=
 */
export async function GET(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return Response.json({ connections: listConnections() });
  } catch (e) {
    return errorResponse(e, 500);
  }
}

export async function POST(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return Response.json({ connection: createConnection(await req.json()) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id, ...input } = await req.json();
    const connection = updateConnection(id, input);
    closePools(id);
    return Response.json({ connection });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const id = new URL(req.url).searchParams.get("id");
    deleteConnection(id);
    closePools(id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
