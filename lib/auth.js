import crypto from "node:crypto";

/**
 * Single super-admin auth, no database needed.
 *
 *   ADMIN_PASSWORD_HASH  scrypt:<salt hex>:<hash hex>   (npm run hash-password)
 *   SESSION_SECRET       random string, 32+ chars        (signs session cookies)
 *   SESSION_DAYS         optional, default 7
 *
 * The session cookie is `<expiresAt>.<nonce>.<hmac>`. The HMAC key mixes
 * SESSION_SECRET with the password hash, so changing the password (or the
 * secret) instantly logs out every existing session.
 */

export const COOKIE = "dbdesk_session";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  // No "$" characters: Coolify / docker compose would try to interpolate them.
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function authConfigError() {
  const h = process.env.ADMIN_PASSWORD_HASH;
  if (!h) return "ADMIN_PASSWORD_HASH is not set. Run `npm run hash-password` and add it to your env.";
  if (!/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/.test(h)) return "ADMIN_PASSWORD_HASH is malformed. Regenerate it with `npm run hash-password`.";
  if ((process.env.SESSION_SECRET || "").length < 32) return "SESSION_SECRET must be set to at least 32 random characters.";
  return null;
}

export function verifyPassword(password) {
  if (authConfigError() || typeof password !== "string") return false;
  const [, saltHex, hashHex] = process.env.ADMIN_PASSWORD_HASH.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  return crypto.timingSafeEqual(actual, expected);
}

function signingKey() {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(process.env.ADMIN_PASSWORD_HASH)
    .digest();
}

const sign = (payload) => crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");

export const sessionMaxAge = () => (Number(process.env.SESSION_DAYS) || 7) * 86400;

export function createSessionToken() {
  const exp = Math.floor(Date.now() / 1000) + sessionMaxAge();
  const payload = `${exp}.${crypto.randomBytes(16).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function isValidSession(token) {
  if (!token || authConfigError()) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [exp, nonce, mac] = parts;
  const expected = Buffer.from(sign(`${exp}.${nonce}`));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  return Number(exp) > Date.now() / 1000;
}

/** Secure flag when the browser is on https (e.g. via `tailscale serve`). */
export function isHttps(req) {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return proto ? proto === "https" : new URL(req.url).protocol === "https:";
}

export function sessionCookie(req, value, maxAge) {
  return {
    name: COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    path: "/",
    maxAge,
  };
}

/** Use in every API route: returns a 401 Response, or null when authenticated. */
export function requireAuth(req) {
  if (isValidSession(req.cookies.get(COOKIE)?.value)) return null;
  return Response.json({ error: "Not signed in" }, { status: 401 });
}

/* ---------- login rate limiting (in memory, per IP + global) ---------- */

const WINDOW_MS = 15 * 60 * 1000;
const PER_IP = 5;
const GLOBAL = 20;
const attempts = (globalThis.__dbdeskLoginAttempts ??= new Map()); // key -> [timestamps]

function recent(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, list);
  return list;
}

export function clientIp(req) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Returns seconds to wait, or 0 if a login attempt is allowed. */
export function loginBlockedFor(ip) {
  const check = (list, max) => (list.length >= max ? Math.ceil((list[0] + WINDOW_MS - Date.now()) / 1000) : 0);
  return Math.max(check(recent(`ip:${ip}`), PER_IP), check(recent("global"), GLOBAL));
}

export function recordFailedLogin(ip) {
  const now = Date.now();
  recent(`ip:${ip}`).push(now);
  recent("global").push(now);
}

export function clearFailedLogins(ip) {
  attempts.delete(`ip:${ip}`);
}
