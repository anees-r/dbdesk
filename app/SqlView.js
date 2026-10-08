"use client";

import { useState } from "react";
import { ResultGrid } from "./Cell";

const DDL = /^\s*(create|alter|drop|truncate|comment)\b/im;

export default function SqlView({ db, onSchemaChange }) {
  const [sql, setSql] = useState("select now();");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [active, setActive] = useState(0);

  async function run(text = sql) {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ server: db.server, db: db.database, sql: text }),
      });
      const d = await r.json();
      setOut(d);
      setActive(d.results ? d.results.length - 1 : 0);
      if (!d.error && DDL.test(text)) onSchemaChange?.();
    } catch (e) {
      setOut({ error: e.message });
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      const ta = e.currentTarget;
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      run(sel.trim() ? sel : sql); // run selection if any
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      const v = ta.value.slice(0, s) + "  " + ta.value.slice(en);
      setSql(v);
      requestAnimationFrame(() => (ta.selectionStart = ta.selectionEnd = s + 2));
    }
  }

  const res = out?.results?.[active];

  return (
    <div className="sql">
      <div className="editor-wrap">
        <textarea
          className="editor"
          spellCheck={false}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write SQL… Ctrl/⌘+Enter runs it (or just the selection)."
        />
        <div className="toolbar">
          <button className="btn primary" disabled={busy} onClick={() => run()}>
            {busy ? "Running…" : "Run ▸"}
          </button>
          <span className="muted small">Ctrl/⌘+Enter · runs selection if any · writes are committed immediately</span>
        </div>
      </div>

      {out?.error && (
        <div className="err banner">
          <b>{out.code ? `[${out.code}] ` : ""}</b>{out.error}
          {out.detail && <div className="small">{out.detail}</div>}
          {out.hint && <div className="small">Hint: {out.hint}</div>}
        </div>
      )}

      {out?.results && (
        <>
          <div className="result-bar">
            {out.results.length > 1 && out.results.map((r, i) => (
              <button key={i} className={`chip ${i === active ? "on" : ""}`} onClick={() => setActive(i)}>
                {i + 1}. {r.command}
              </button>
            ))}
            <span className="muted small">
              {res.command} · {res.columns.length ? `${res.rows.length} rows` : `${res.rowCount ?? 0} affected`} · {out.ms} ms
            </span>
          </div>
          {res.columns.length > 0 && <ResultGrid columns={res.columns} rows={res.rows} />}
        </>
      )}
    </div>
  );
}
