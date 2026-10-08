"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataView from "./DataView";
import SqlView from "./SqlView";

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export default function Home() {
  const [dbs, setDbs] = useState([]);
  const [dbErrors, setDbErrors] = useState([]);
  const [db, setDb] = useState(null); // { server, database }
  const [tables, setTables] = useState([]);
  const [tableFilter, setTableFilter] = useState("");
  const [table, setTable] = useState(null); // { schema, name, kind }
  const [tab, setTab] = useState("data");
  const [error, setError] = useState(null);

  // Session expired mid-use -> back to the login page.
  useEffect(() => {
    const orig = window.fetch;
    window.fetch = async (...args) => {
      const res = await orig(...args);
      const url = String(args[0]?.url ?? args[0]);
      if (res.status === 401 && url.startsWith("/api/") && !url.startsWith("/api/auth/")) {
        window.location.replace("/login");
      }
      return res;
    };
    return () => { window.fetch = orig; };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.replace("/login");
  }

  useEffect(() => {
    fetch("/api/databases").then((r) => r.json()).then((d) => {
      if (d.error) return setError(d.error);
      setDbs(d.databases);
      setDbErrors(d.errors || []);
      const last = store.get("dbdesk.db");
      const found = last && d.databases.find((x) => x.server === last.server && x.database === last.database);
      setDb(found || d.databases[0] || null);
    }).catch((e) => setError(e.message));
  }, []);

  const loadTables = useCallback(() => {
    if (!db) return;
    setTables([]);
    fetch(`/api/tables?server=${encodeURIComponent(db.server)}&db=${encodeURIComponent(db.database)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setTables(d.tables)));
  }, [db]);

  useEffect(() => {
    if (!db) return;
    store.set("dbdesk.db", db);
    setTable(null);
    setError(null);
    loadTables();
  }, [db, loadTables]);

  const multiServer = new Set(dbs.map((d) => d.server)).size > 1;
  const dbKey = (d) => `${d.server}\u0000${d.database}`;

  const grouped = useMemo(() => {
    const f = tableFilter.toLowerCase();
    const g = {};
    for (const t of tables) {
      if (f && !`${t.schema}.${t.name}`.toLowerCase().includes(f)) continue;
      (g[t.schema] ??= []).push(t);
    }
    return g;
  }, [tables, tableFilter]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="row brand-row">
          <div className="brand">db<span>desk</span></div>
          <button className="btn sm" onClick={logout} title="Sign out">Sign out</button>
        </div>
        <label className="label">Database</label>
        <select
          className="select"
          value={db ? dbKey(db) : ""}
          onChange={(e) => setDb(dbs.find((d) => dbKey(d) === e.target.value))}
        >
          {dbs.map((d) => (
            <option key={dbKey(d)} value={dbKey(d)}>
              {multiServer ? `${d.server} / ` : ""}{d.database} ({d.size})
            </option>
          ))}
        </select>
        {dbErrors.map((e) => (
          <div key={e.server} className="err small">{e.server}: {e.error}</div>
        ))}

        <div className="row gap">
          <input className="input" placeholder="Filter tables…" value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} />
          <button className="btn icon" title="Refresh" onClick={loadTables}>↻</button>
        </div>

        <nav className="tables">
          {Object.entries(grouped).map(([schema, list]) => (
            <div key={schema}>
              <div className="schema">{schema}</div>
              {list.map((t) => {
                const active = table?.schema === t.schema && table?.name === t.name;
                return (
                  <button
                    key={t.name}
                    className={`table-item ${active ? "active" : ""}`}
                    onClick={() => { setTable(t); setTab("data"); }}
                  >
                    <span className={`kind kind-${t.kind}`}>{t.kind[0]}</span>
                    <span className="tname">{t.name}</span>
                    <span className="est">{t.kind === "table" && Number(t.estimate) > 0 ? `~${fmt(t.estimate)}` : ""}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {db && !tables.length && <div className="muted small pad">No tables</div>}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="tabs">
            <button className={`tab ${tab === "data" ? "on" : ""}`} onClick={() => setTab("data")}>Data</button>
            <button className={`tab ${tab === "sql" ? "on" : ""}`} onClick={() => setTab("sql")}>SQL</button>
          </div>
          <div className="crumb">
            {db && <>{multiServer && `${db.server} / `}<b>{db.database}</b></>}
            {table && tab === "data" && <> / {table.schema}.<b>{table.name}</b></>}
          </div>
        </header>
        {error && <div className="err banner">{error}</div>}
        {!dbs.length && !error && (
          <div className="empty">No databases. Set <code>DATABASE_URL</code> or <code>DATABASE_SERVERS</code>.</div>
        )}
        {db && tab === "data" && (table ? (
          <DataView key={`${dbKey(db)}/${table.schema}.${table.name}`} db={db} table={table} />
        ) : (
          <div className="empty">Pick a table on the left, or open the SQL tab.</div>
        ))}
        {db && (
          <div style={{ display: tab === "sql" ? "contents" : "none" }}>
            <SqlView key={dbKey(db)} db={db} onSchemaChange={loadTables} />
          </div>
        )}
      </main>
    </div>
  );
}

const fmt = (n) => Number(n).toLocaleString();
