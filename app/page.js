"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataView from "./DataView";
import SqlView from "./SqlView";
import ConnectionDialog from "./ConnectionDialog";
import SchemaView from "./SchemaView";
import { Footer, Select, Skeleton, Spinner } from "./ui";

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
  const [connections, setConnections] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState(null); // null | {} (new) | connection (edit)
  const [tablesLoading, setTablesLoading] = useState(false);

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

  // prefer: connection id to select afterwards (after adding/editing one)
  const loadDbs = useCallback(async (prefer) => {
    try {
      const [d, c] = await Promise.all([
        fetch("/api/databases").then((r) => r.json()),
        fetch("/api/connections").then((r) => r.json()),
      ]);
      if (d.error || c.error) return setError(d.error || c.error);
      setConnections(c.connections);
      setDbs(d.databases);
      setDbErrors(d.errors || []);
      const last = store.get("dbdesk.db");
      const same = (x, y) => x && y && x.server === y.server && x.database === y.database;
      setDb((cur) =>
        (prefer && d.databases.find((x) => x.server === prefer)) ||
        d.databases.find((x) => same(x, cur)) ||
        d.databases.find((x) => same(x, last)) ||
        d.databases[0] ||
        null
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { loadDbs(); }, [loadDbs]);

  // Ignore table lists that arrive after the selected db changed (or was removed).
  const dbRef = useRef(db);
  dbRef.current = db;

  const loadTables = useCallback(() => {
    if (!db) return;
    setTablesLoading(true);
    const stale = () => dbRef.current !== db;
    fetch(`/api/tables?server=${encodeURIComponent(db.server)}&db=${encodeURIComponent(db.database)}`)
      .then((r) => r.json())
      .then((d) => !stale() && (d.error ? setError(d.error) : setTables(d.tables)))
      .catch((e) => !stale() && setError(e.message))
      .finally(() => !stale() && setTablesLoading(false));
  }, [db]);

  useEffect(() => {
    setTables([]);
    setTable(null);
    setError(null);
    setTablesLoading(false);
    if (!db) return;
    store.set("dbdesk.db", db);
    loadTables();
  }, [db, loadTables]);

  const openTable = (t, nextTab) => { setTable(t); setTab(nextTab); };
  const dbLabel = (d) => (d.all ? `${d.name} / ${d.database}` : d.name);
  const currentConn = db && connections.find((c) => c.id === db.server);
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
        <div className="row gap">
          <label className="label">Database</label>
          <div className="spacer" />
          {currentConn && !currentConn.readOnly && (
            <button className="btn sm" onClick={() => setDialog(currentConn)} title="Edit this connection">Edit</button>
          )}
          <button className="btn sm" onClick={() => setDialog({})} title="Add a connection">+ Add</button>
        </div>
        {!loaded && <div className="sk-line tall" />}
        {loaded && dbs.length > 0 && (
          <Select
            value={db ? dbKey(db) : ""}
            options={dbs.map((d) => ({ value: dbKey(d), label: dbLabel(d), hint: d.size }))}
            onChange={(v) => setDb(dbs.find((d) => dbKey(d) === v))}
          />
        )}
        {dbErrors.map((e) => {
          const conn = connections.find((c) => c.id === e.server);
          return (
            <div key={e.server} className="err small conn-err">
              <span>{e.name}: {e.error}</span>
              {conn && !conn.readOnly && <button className="btn sm" onClick={() => setDialog(conn)}>Edit</button>}
            </div>
          );
        })}

        <div className="row gap">
          <input className="input" placeholder="Filter tables…" value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} />
          <button className="btn icon" title="Refresh" onClick={loadTables} disabled={!db}>{tablesLoading ? <Spinner /> : "↻"}</button>
        </div>

        <nav className="tables">
          {(!loaded || (tablesLoading && !tables.length)) && <div className="pad"><Skeleton rows={9} /></div>}
          {Object.entries(grouped).map(([schema, list]) => (
            <div key={schema} className="schema-group">
              <div className="schema">{schema}</div>
              {list.map((t) => {
                const active = table?.schema === t.schema && table?.name === t.name;
                return (
                  <button
                    key={t.name}
                    className={`table-item ${active ? "active" : ""}`}
                    onClick={() => openTable(t, tab === "structure" ? "structure" : "data")}
                  >
                    <span className={`kind kind-${t.kind}`}>{t.kind[0]}</span>
                    <span className="tname">{t.name}</span>
                    <span className="est">{t.kind === "table" && Number(t.estimate) > 0 ? `~${fmt(t.estimate)}` : ""}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {db && !tablesLoading && !tables.length && <div className="muted small pad">No tables</div>}
        </nav>
        <Footer />
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="tabs">
            <button className={`tab ${tab === "data" ? "on" : ""}`} onClick={() => setTab("data")}>Data</button>
            <button className={`tab ${tab === "structure" ? "on" : ""}`} onClick={() => setTab("structure")}>Structure</button>
            <button className={`tab ${tab === "sql" ? "on" : ""}`} onClick={() => setTab("sql")}>SQL</button>
          </div>
          <div className="crumb">
            {db && <>{db.all && `${db.name} / `}<b>{db.all ? db.database : db.name}</b></>}
            {table && tab !== "sql" && <> / {table.schema}.<b>{table.name}</b></>}
          </div>
        </header>
        {error && <div className="err banner">{error}</div>}
        {!loaded && <div className="empty"><Spinner size={22} /></div>}
        {loaded && !dbs.length && !error && (
          <div className="empty">
            {connections.length ? "None of your connections could be reached." : "No connections yet."}
            <div><button className="btn primary" style={{ marginTop: 12 }} onClick={() => setDialog({})}>+ Add connection</button></div>
          </div>
        )}
        {db && tab === "data" && (table ? (
          <DataView key={`${dbKey(db)}/${table.schema}.${table.name}`} db={db} table={table} />
        ) : (
          <div className="empty view">
            Pick a table on the left, or
            <div className="row gap" style={{ justifyContent: "center", marginTop: 12 }}>
              <button className="btn" onClick={() => setTab("structure")}>Browse schema</button>
              <button className="btn" onClick={() => setTab("sql")}>Open SQL</button>
            </div>
          </div>
        ))}
        {db && tab === "structure" && (
          <SchemaView key={`${dbKey(db)}/${table ? `${table.schema}.${table.name}` : ""}`} db={db} table={table} onOpen={openTable} />
        )}
        {db && (
          <div style={{ display: tab === "sql" ? "contents" : "none" }}>
            <SqlView key={dbKey(db)} db={db} onSchemaChange={loadTables} />
          </div>
        )}
      </main>

      {dialog && (
        <ConnectionDialog
          key={dialog.id ?? "new"}
          initial={dialog}
          onClose={() => setDialog(null)}
          onSaved={(c) => { setDialog(null); loadDbs(c.id); }}
          onDeleted={() => { setDialog(null); setDb(null); loadDbs(); }}
        />
      )}
    </div>
  );
}

const fmt = (n) => Number(n).toLocaleString();
