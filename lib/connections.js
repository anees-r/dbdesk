import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Connections added from the UI, stored in dbdesk's own Postgres database
 * (DBDESK_DATABASE_URL), table dbdesk_connections. Each row holds the *whole*
 * connection (name, host, user, password, ...) as one AES-256-GCM blob, keyed
 * by DBDESK_ENCRYPTION_KEY, which lives only in the environment. The table
 * itself shows nothing but ids, key versions and timestamps.
 *
 * Key rotation: set the new key as DBDESK_ENCRYPTION_KEY with a higher
 * DBDESK_ENCRYPTION_KEY_VERSION and put the old one in DBDESK_OLD_ENCRYPTION_KEYS
 * ("1:<base64>,2:<base64>"). Rows are re-encrypted with the new key the next
 * time they're read; after that the old key can be removed.
 *
 * Connections from env (DATABASE_URL / DATABASE_SERVERS) still work and show up read-only,
 * with ids prefixed "env:".
 */

export const SSL_MODES = ["disable", "require", "verify-full"];

/* ---------- encryption ---------- */

function parseKey(b64, label) {
  const k = Buffer.from(b64 || "", "base64");
  if (k.length !== 32) throw new Error(`${label} must be 32 random bytes, base64-encoded (openssl rand -base64 32)`);
  return k;
}

function keyring() {
  if (!process.env.DBDESK_ENCRYPTION_KEY) throw new Error("DBDESK_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  const current = Number(process.env.DBDESK_ENCRYPTION_KEY_VERSION) || 1;
  const keys = new Map();
  for (const entry of (process.env.DBDESK_OLD_ENCRYPTION_KEYS || "").split(",").filter(Boolean)) {
    const [v, b64] = entry.trim().split(":");
    keys.set(Number(v), parseKey(b64, `DBDESK_OLD_ENCRYPTION_KEYS (version ${v})`));
  }
  keys.set(current, parseKey(process.env.DBDESK_ENCRYPTION_KEY, "DBDESK_ENCRYPTION_KEY"));
  return { current, keys };
}

// The row id and key version are bound in as associated data, so a blob
// copied onto another row (or relabelled with another version) won't decrypt.
const aad = (id, version) => Buffer.from(`dbdesk-connection:${id}:${version}`);

function seal(id, record) {
  const { current, keys } = keyring();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keys.get(current), iv);
  c.setAAD(aad(id, current));
  const ct = Buffer.concat([c.update(JSON.stringify(record), "utf8"), c.final()]);
  return { version: current, data: [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".") };
}

function open(id, version, data) {
  const key = keyring().keys.get(version);
  if (!key) throw new Error(`Saved connection ${id} uses encryption key version ${version}, which isn't configured`);
  try {
    const [iv, tag, ct] = data.split(".").map((s) => Buffer.from(s, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(aad(id, version));
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
  } catch {
    throw new Error(`Can't decrypt saved connection ${id} (wrong DBDESK_ENCRYPTION_KEY, or the row was modified)`);
  }
}

/* ---------- store ---------- */

function store() {
  if (!process.env.DBDESK_DATABASE_URL) throw new Error("DBDESK_DATABASE_URL is not set. dbdesk keeps saved connections in that Postgres database.");
  globalThis.__dbdeskStore ??= (() => {
    const pool = new pg.Pool({ connectionString: process.env.DBDESK_DATABASE_URL, max: 2, idleTimeoutMillis: 60_000 });
    pool.on("error", (err) => console.error("[store]", err.message));
    const ready = init(pool);
    ready.catch(() => (globalThis.__dbdeskStore = undefined)); // retry on the next request
    return { pool, ready };
  })();
  return globalThis.__dbdeskStore;
}

async function init(pool) {
  await pool.query(`create table if not exists dbdesk_connections (
    id          text primary key,
    key_version integer not null,
    data        text not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
  )`);
  await importLegacyFile(pool);
}

async function db() {
  const s = store();
  await s.ready;
  return s.pool;
}

async function readSaved() {
  const pool = await db();
  const { current } = keyring();
  const { rows } = await pool.query("select id, key_version, data from dbdesk_connections order by created_at, id");
  const list = rows.map((r) => ({ id: r.id, ...open(r.id, r.key_version, r.data) }));
  // lazy key rotation
  for (const [i, r] of rows.entries()) if (r.key_version !== current) await writeRow(pool, list[i], "update");
  return list;
}

async function writeRow(pool, { id, ...record }, mode) {
  const { version, data } = seal(id, record);
  if (mode === "insert") {
    await pool.query("insert into dbdesk_connections (id, key_version, data) values ($1, $2, $3)", [id, version, data]);
  } else {
    await pool.query("update dbdesk_connections set key_version = $2, data = $3, updated_at = now() where id = $1", [id, version, data]);
  }
}

/**
 * One-time move from the old $DATA_DIR/connections.json store (passwords
 * encrypted with a key derived from SESSION_SECRET) into the table, when the
 * table is still empty. The file is renamed afterwards.
 */
async function importLegacyFile(pool) {
  const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "connections.json");
  if (!fs.existsSync(file)) return;
  const { rows } = await pool.query("select 1 from dbdesk_connections limit 1");
  if (rows.length) return;
  const legacyKey = Buffer.from(crypto.hkdfSync("sha256", process.env.SESSION_SECRET || "", "", "dbdesk-connections", 32));
  const legacyDecrypt = (blob) => {
    try {
      const [, iv, tag, ct] = blob.split(":").map((x, i) => (i ? Buffer.from(x, "base64url") : x));
      const d = crypto.createDecipheriv("aes-256-gcm", legacyKey, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
    } catch {
      return ""; // re-enter it in the UI
    }
  };
  for (const c of JSON.parse(fs.readFileSync(file, "utf8"))) {
    await writeRow(pool, { ...c, password: c.password ? legacyDecrypt(c.password) : "" }, "insert");
  }
  fs.renameSync(file, `${file}.imported`);
  console.log(`[store] imported saved connections from ${file}`);
}

function envConnections() {
  const list = process.env.DATABASE_SERVERS
    ? JSON.parse(process.env.DATABASE_SERVERS)
    : process.env.DATABASE_URL
    ? [{ name: "default", url: process.env.DATABASE_URL }]
    : [];
  return list.map((s) => ({ id: `env:${s.name}`, name: s.name, url: s.url, allDatabases: true, readOnly: true }));
}

/** Without secrets, for the UI. */
const publicView = ({ password, url, ...c }) => ({
  ...c,
  hasPassword: Boolean(password),
  ...(url && { database: decodeURIComponent(new URL(url).pathname.slice(1)) || "postgres" }),
});

export async function listConnections() {
  return [...envConnections(), ...(await readSaved())].map(publicView);
}

async function findConnection(id) {
  const c = id?.startsWith("env:") ? envConnections().find((x) => x.id === id) : (await readSaved()).find((x) => x.id === id);
  if (!c) throw new Error(`Unknown connection "${id}"`);
  return c;
}

/* ---------- validation ---------- */

function clean(input, existing) {
  const s = (v) => (v == null ? "" : String(v).trim());
  const c = {
    name: s(input.name),
    host: s(input.host),
    port: Number(input.port) || 5432,
    database: s(input.database) || "postgres",
    user: s(input.user),
    ssl: SSL_MODES.includes(input.ssl) ? input.ssl : "disable",
    allDatabases: Boolean(input.allDatabases),
  };
  if (!c.name) throw new Error("Name is required");
  if (!c.host) throw new Error("Host is required");
  if (!c.user) throw new Error("User is required");
  if (c.port < 1 || c.port > 65535) throw new Error("Port must be 1–65535");
  // password: undefined = keep the stored one, string (even "") = replace
  c.password = typeof input.password === "string" ? input.password : existing?.password ?? "";
  return c;
}

export async function createConnection(input) {
  const list = await readSaved();
  const c = { id: crypto.randomUUID(), ...clean(input) };
  if (list.some((x) => x.name === c.name)) throw new Error(`A connection named "${c.name}" already exists`);
  await writeRow(await db(), c, "insert");
  return publicView(c);
}

export async function updateConnection(id, input) {
  if (id?.startsWith("env:")) throw new Error("Env connections can't be edited here");
  const list = await readSaved();
  const existing = list.find((x) => x.id === id);
  if (!existing) throw new Error("Connection not found");
  const c = { id, ...clean(input, existing) };
  if (list.some((x) => x.id !== id && x.name === c.name)) throw new Error(`A connection named "${c.name}" already exists`);
  await writeRow(await db(), c, "update");
  return publicView(c);
}

export async function deleteConnection(id) {
  const { rowCount } = await (await db()).query("delete from dbdesk_connections where id = $1", [id]);
  if (!rowCount) throw new Error("Connection not found");
}

/* ---------- pg config ---------- */

const sslOption = (mode) => (mode === "require" ? { rejectUnauthorized: false } : mode === "verify-full" ? true : false);

function pgConfig(c, database) {
  if (c.url) {
    const url = new URL(c.url);
    if (database) url.pathname = "/" + encodeURIComponent(database);
    return { connectionString: url.toString() };
  }
  return {
    host: c.host,
    port: c.port,
    database: database || c.database,
    user: c.user,
    password: c.password || undefined,
    ssl: sslOption(c.ssl),
  };
}

export async function connectionConfig(id, database) {
  return pgConfig(await findConnection(id), database);
}

/** Config for an unsaved form (Test button). Falls back to the stored password when editing. */
export async function draftConfig(input) {
  const existing = input.id ? (await readSaved()).find((x) => x.id === input.id) : null;
  return pgConfig(clean({ name: "test", ...input }, existing));
}
