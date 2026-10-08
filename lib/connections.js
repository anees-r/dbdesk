import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Connections added from the UI, stored in $DATA_DIR/connections.json
 * (default ./data). Passwords are encrypted with AES-256-GCM using a key
 * derived from SESSION_SECRET, so changing the secret means re-entering
 * saved passwords (the rest of each connection is kept).
 *
 * Connections from env (DATABASE_URL / DATABASE_SERVERS) still work and show
 * up read-only, with ids prefixed "env:".
 */

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "connections.json");
export const SSL_MODES = ["disable", "require", "verify-full"];

/* ---------- password encryption ---------- */

const key = () =>
  Buffer.from(crypto.hkdfSync("sha256", process.env.SESSION_SECRET || "", "", "dbdesk-connections", 32));

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), ct].map((x) => (typeof x === "string" ? x : x.toString("base64url"))).join(":");
}

function decrypt(blob) {
  try {
    const [, iv, tag, ct] = blob.split(":").map((x, i) => (i ? Buffer.from(x, "base64url") : x));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    throw new Error("Can't decrypt the saved password (was SESSION_SECRET changed?). Edit the connection and re-enter it.");
  }
}

/* ---------- file store ---------- */

function readSaved() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

function writeSaved(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
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

export function listConnections() {
  return [...envConnections(), ...readSaved()].map(publicView);
}

function findConnection(id) {
  const c = [...envConnections(), ...readSaved()].find((x) => x.id === id);
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
  if (typeof input.password === "string") c.password = input.password ? encrypt(input.password) : "";
  else c.password = existing?.password ?? "";
  return c;
}

export function createConnection(input) {
  const list = readSaved();
  const c = { id: crypto.randomUUID(), ...clean(input) };
  if (list.some((x) => x.name === c.name)) throw new Error(`A connection named "${c.name}" already exists`);
  writeSaved([...list, c]);
  return publicView(c);
}

export function updateConnection(id, input) {
  const list = readSaved();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(id.startsWith("env:") ? "Env connections can't be edited here" : "Connection not found");
  const c = { id, ...clean(input, list[i]) };
  if (list.some((x) => x.id !== id && x.name === c.name)) throw new Error(`A connection named "${c.name}" already exists`);
  list[i] = c;
  writeSaved(list);
  return publicView(c);
}

export function deleteConnection(id) {
  const list = readSaved();
  if (!list.some((x) => x.id === id)) throw new Error("Connection not found");
  writeSaved(list.filter((x) => x.id !== id));
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
    password: c.password ? decrypt(c.password) : undefined,
    ssl: sslOption(c.ssl),
  };
}

export function connectionConfig(id, database) {
  return pgConfig(findConnection(id), database);
}

/** Config for an unsaved form (Test button). Falls back to the stored password when editing. */
export function draftConfig(input) {
  const existing = input.id ? readSaved().find((x) => x.id === input.id) : null;
  return pgConfig(clean({ name: "test", ...input }, existing));
}
