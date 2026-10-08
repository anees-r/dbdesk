"use client";

import { useState } from "react";
import { Modal, Select, Spinner, useConfirm } from "./ui";

const EMPTY = { name: "", host: "", port: "5432", database: "postgres", user: "", ssl: "disable", allDatabases: false };

/** postgres://user:pass@host:5432/db?sslmode=require -> form fields */
function parseUrl(text) {
  const m = text.trim().match(/^postgres(?:ql)?:\/\/(.*)$/i);
  if (!m) throw new Error("Expected postgres://user:password@host:port/database");
  const url = new URL("http://" + m[1]); // http: so every browser parses host/port the same way
  const dec = (s) => decodeURIComponent(s || "");
  const sslmode = url.searchParams.get("sslmode") || (url.searchParams.get("ssl") === "true" ? "require" : "");
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port || "5432",
    database: dec(url.pathname.slice(1)) || "postgres",
    user: dec(url.username),
    password: dec(url.password),
    ssl: sslmode === "verify-full" || sslmode === "verify-ca" ? "verify-full" : ["require", "prefer", "allow"].includes(sslmode) ? "require" : "disable",
  };
}

export default function ConnectionDialog({ initial, onClose, onSaved, onDeleted }) {
  const editing = Boolean(initial?.id);
  const [f, setF] = useState(() => (editing ? { ...EMPTY, ...initial, port: String(initial.port) } : EMPTY));
  // undefined = keep stored password (editing); string = new value
  const [password, setPassword] = useState(editing ? undefined : "");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false); // false | "test" | "save" | "delete"
  const confirm = useConfirm();
  const set = (patch) => { setF((s) => ({ ...s, ...patch })); setStatus(null); };

  function applyUrl(text) {
    setUrl(text);
    if (!text.trim()) return;
    try {
      const { password: pw, ...fields } = parseUrl(text);
      set({ ...fields, name: f.name || fields.database });
      setPassword(pw);
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    }
  }

  const body = () => JSON.stringify({ ...f, ...(editing && { id: initial.id }), ...(password !== undefined && { password }) });

  async function call(method, path, payload, what) {
    setBusy(what);
    setStatus(null);
    try {
      const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: payload });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      return d;
    } catch (e) {
      setStatus({ ok: false, text: e.message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    const d = await call("POST", "/api/connections/test", body(), "test");
    if (d) setStatus({ ok: true, text: `Connected as ${d.user} · Postgres ${d.version} · ${d.ms} ms` });
  }

  async function save(e) {
    e.preventDefault();
    const d = await call(editing ? "PUT" : "POST", "/api/connections", body(), "save");
    if (d) onSaved(d.connection);
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete "${initial.name}"?`,
      body: "The saved connection is removed. The database itself is not touched.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const d = await call("DELETE", `/api/connections?id=${encodeURIComponent(initial.id)}`, undefined, "delete");
    if (d) onDeleted(initial.id);
  }

  return (
    <Modal as="form" onClose={onClose} onSubmit={save}>
      {(close) => (<>
        <h3>{editing ? "Edit connection" : "New connection"}</h3>
        <div className="fields">
          <label className="field">
            <span className="fname">Name</span>
            <input className="input" autoFocus placeholder="e.g. Prod, Home server" value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </label>

          <label className="field">
            <span className="fname">Connection string <span className="type">optional · fills the fields below</span></span>
            <input
              className="input mono"
              placeholder="postgres://user:password@host:5432/database"
              value={url}
              onChange={(e) => applyUrl(e.target.value)}
            />
          </label>

          <div className="conn-grid">
            <label className="field">
              <span className="fname">Host</span>
              <input className="input mono" placeholder="localhost" value={f.host} onChange={(e) => set({ host: e.target.value })} />
            </label>
            <label className="field">
              <span className="fname">Port</span>
              <input className="input mono" inputMode="numeric" value={f.port} onChange={(e) => set({ port: e.target.value })} />
            </label>
          </div>

          <label className="field">
            <span className="fname">Database</span>
            <input className="input mono" value={f.database} onChange={(e) => set({ database: e.target.value })} />
          </label>

          <div className="conn-grid even">
            <label className="field">
              <span className="fname">User</span>
              <input className="input mono" autoComplete="off" value={f.user} onChange={(e) => set({ user: e.target.value })} />
            </label>
            <label className="field">
              <span className="fname">Password</span>
              <input
                className="input mono"
                type="password"
                autoComplete="new-password"
                placeholder={editing && password === undefined ? (initial.hasPassword ? "•••••• (unchanged)" : "(none)") : ""}
                value={password ?? ""}
                onChange={(e) => { setPassword(e.target.value); setStatus(null); }}
              />
            </label>
          </div>

          <div className="field">
            <span className="fname">SSL</span>
            <Select
              value={f.ssl}
              onChange={(ssl) => set({ ssl })}
              options={[
                { value: "disable", label: "Off", hint: "local / private network" },
                { value: "require", label: "Require", hint: "encrypted, cert not verified" },
                { value: "verify-full", label: "Verify certificate", hint: "encrypted + trusted CA" },
              ]}
            />
          </div>

          <label className="row gap small">
            <input type="checkbox" checked={f.allDatabases} onChange={(e) => set({ allDatabases: e.target.checked })} />
            Show every database on this server, not just <code>{f.database || "postgres"}</code>
          </label>
        </div>

        {status && <div key={status.text} className={status.ok ? "ok-banner" : "err banner"}>{status.text}</div>}

        <div className="row gap">
          {editing && (
            <button type="button" className="btn danger" disabled={Boolean(busy)} onClick={remove}>
              {busy === "delete" && <Spinner size={12} />} Delete
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={test}>
            {busy === "test" && <Spinner size={12} />} Test
          </button>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={Boolean(busy)}>
            {busy === "save" && <Spinner size={12} />} {editing ? "Save" : "Add"}
          </button>
        </div>
      </>)}
    </Modal>
  );
}
