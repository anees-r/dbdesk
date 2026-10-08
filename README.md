# dbdesk

A private, full read/write Postgres client for a home server. Next.js 16 (App Router, plain JavaScript) with `pg`. It is protected by a single super-admin password and is meant to be reachable only over Tailscale, so there are two layers.

## What the prototype does

- **Connections.** Add, edit and delete Postgres connections from the sidebar (**+ Add**).
  - Give each one a name, then fill in host, port, database, user, password and SSL, or paste a `postgres://` connection string to fill them.
  - **Test** checks the connection before you save it.
  - A connection shows just its own database, or every database on the server if you tick that box.
  - They're stored in `$DATA_DIR/connections.json` (default `./data`). Passwords are encrypted with AES-256-GCM using a key derived from `SESSION_SECRET`. If you change the secret, re-enter saved passwords.
  - Connections from `DATABASE_URL` / `DATABASE_SERVERS` still work and appear read-only.
- **Table browser.** Tables, views and materialized views are grouped by schema, with a filter and row estimates.
- **Data tab.**
  - Pagination (50–500 rows per page), with sorting when you click a column header.
  - A raw `WHERE` filter box. It runs in a read-only transaction.
  - Double-click a cell to edit it: Enter saves, Esc cancels, and there is a NULL button.
  - Select rows to delete them, or use **+ Row** to insert with a value, default or null per column.
  - Every write runs in a transaction and rolls back if it doesn't hit exactly the expected number of rows.
  - Tables without a primary key fall back to `ctid`. Views are read-only.
- **Structure tab.** With no table selected it shows a schema overview: every table as a card with columns, keys and foreign-key links. Hover a card to highlight its related tables. With a table selected it shows columns, indexes, constraints, the tables that reference it, and generated DDL you can copy.
- **SQL tab.** Runs any SQL, including several statements at once, with one result tab per statement.
  - Ctrl/⌘+Enter runs the query, or just the selection if there is one.
  - Errors show the Postgres code, detail and hint.
  - There is a statement timeout.
- **Exact values.** Every value comes back as Postgres' own text form, so `numeric`, `bigint`, `timestamptz`, `jsonb`, arrays and `bytea` display exactly. Editing round-trips through the same text.

## Login

There is one admin password and no signup or users table. dbdesk doesn't need a database of its own.

- `npm run hash-password` asks for a password (at least 12 characters, input hidden). It prints two env lines:
  - `ADMIN_PASSWORD_HASH`, an scrypt hash in the form `scrypt:salt:hash`. It contains no `$`, so Coolify won't mangle it.
  - `SESSION_SECRET`, random bytes used to sign the session cookie.
- Signing in sets an httpOnly, SameSite=Lax cookie `dbdesk_session` that lasts `SESSION_DAYS` (default 7). It gets the `Secure` flag automatically when you're on https, such as through `tailscale serve`.
- `proxy.js` sends anyone without a valid session to `/login`. Every API route also checks the session itself.
- Failed logins are rate-limited: 5 per IP and 20 in total per 15 minutes, with a short delay on each failure.
- **To change the password**, run the script again and replace `ADMIN_PASSWORD_HASH`. You can keep the old `SESSION_SECRET`. Changing either value signs out every session.
- If either variable is missing or malformed, the app fails closed: nothing works and login shows what's wrong.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run hash-password        # paste both lines into .env.local
npm run dev                  # http://localhost:3000, then "+ Add" a connection
```

## Deploy on Coolify (Tailscale-only)

1. Push this folder to a Git repo, then in Coolify go to **New Resource → Application → your repo**. Set **Build Pack: Dockerfile** and **Port: 3000**.
2. **Leave the Domains field empty.** That keeps Traefik from routing to the app, so nothing appears on Cloudflare or the public internet.
3. **Environment variables:**
   - Paste `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` from `npm run hash-password`. Run it on your PC, or in the app's Coolify terminal with `node scripts/hash-password.mjs`, then redeploy.
4. **Persistent storage:** add a volume mounted at `/app/data` so saved connections survive redeploys.
   - Then add connections in the app. For a Coolify Postgres resource, paste its *Postgres URL (internal)*.
   - If the app can't resolve that hostname, turn on **Connect To Predefined Network** in the app's Advanced settings.
5. **Expose it on the tailnet only.** Pick one option:
   - **A. Tailscale Serve (recommended).** This gives you HTTPS and a MagicDNS name.
     - Set *Ports Mappings* to `127.0.0.1:3000:3000`.
     - On the host, run `sudo tailscale serve --bg --https=8443 http://127.0.0.1:3000`.
     - Open `https://<host>.<tailnet>.ts.net:8443`. The setting persists across reboots.
   - **B. Bind to the Tailscale IP.**
     - Set *Ports Mappings* to `100.x.y.z:3000:3000`, using your host's `tailscale ip -4`.
     - Open `http://100.x.y.z:3000`.
     - If the container fails to start after a reboot because Docker came up before Tailscale, add `After=tailscaled.service` to Docker's systemd unit, or use option A.
6. Never map a plain `3000:3000`. That binds to `0.0.0.0`, so a forwarded router port or open firewall would put your DB client, guarded only by the password, on the internet.

## Layout

```
proxy.js                  redirects to /login without a valid session
lib/auth.js               scrypt verify, signed session cookie, login rate limit
lib/connections.js        saved connections (JSON file, encrypted passwords) + env connections
lib/db.js                 pool per connection/database, identifier quoting, column metadata
app/login                 login page
app/api/auth/login|logout POST sign in / sign out
app/api/connections       GET/POST/PUT/DELETE saved connections; /test tries one
app/api/databases         GET  list databases for every connection
app/api/tables            GET  tables/views in a database
app/api/table             GET  page of rows + columns + pk + count
app/api/rows              POST insert / update / delete (parameterized)
app/api/query             POST run arbitrary SQL
app/api/schema            GET  schema overview, or one table's structure + DDL
app/page.js               shell: db dropdown, table list, tabs
app/ConnectionDialog.js   add / edit / test / delete a connection
app/DataView.js           grid, edit, insert, delete, paging
app/SqlView.js            SQL editor + results
app/SchemaView.js         schema overview cards + table structure
app/ui.js                 Modal, confirm dialog, spinner, skeleton, progress bar
scripts/hash-password.mjs prints ADMIN_PASSWORD_HASH + SESSION_SECRET
```
