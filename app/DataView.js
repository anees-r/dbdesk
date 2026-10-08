"use client";

import { useCallback, useEffect, useState } from "react";
import { CellValue } from "./Cell";
import { Modal, Progress, Select, Skeleton, Spinner, useConfirm } from "./ui";

const PAGE_SIZES = [50, 100, 250, 500];

export default function DataView({ db, table }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState(null); // { col, dir }
  const [whereInput, setWhereInput] = useState("");
  const [where, setWhere] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null); // { r, c, value }
  const [selected, setSelected] = useState(new Set());
  const [inserting, setInserting] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams({
      server: db.server, db: db.database, schema: table.schema, table: table.name,
      page, pageSize, where,
      ...(sort && { sort: sort.col, dir: sort.dir }),
    });
    try {
      const d = await (await fetch(`/api/table?${q}`)).json();
      if (d.error) { setError(d); } else { setData(d); setError(null); }
    } catch (e) {
      setError({ error: e.message });
    } finally {
      setLoading(false);
      setSelected(new Set());
      setEditing(null);
    }
  }, [db, table, page, pageSize, sort, where]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 2500); };

  async function mutate(body) {
    const r = await fetch("/api/rows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ server: db.server, db: db.database, schema: table.schema, table: table.name, ...body }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error + (d.detail ? ` — ${d.detail}` : ""));
    return d;
  }

  const ncols = data?.columns.length ?? 0;
  const rowKey = (row) => {
    if (data.keyMode === "ctid") return { __ctid: row[ncols] };
    const k = {};
    data.columns.forEach((c, i) => { if (c.pk) k[c.name] = row[i]; });
    return k;
  };
  const canEdit = data?.editable && data.keyMode !== "none";

  async function saveEdit(value) {
    const { r, c } = editing;
    const row = data.rows[r];
    if (value === row[c]) return setEditing(null);
    try {
      const d = await mutate({ action: "update", key: rowKey(row), values: { [data.columns[c].name]: value } });
      // Patch the row locally from RETURNING * (keeps ctid stale-safe by reloading for ctid tables)
      if (data.keyMode === "ctid") return load();
      const updated = data.columns.map((col) => d.rows[0][col.name]);
      setData({ ...data, rows: data.rows.map((x, i) => (i === r ? updated : x)) });
      setEditing(null);
      flash("Saved");
    } catch (e) {
      setError({ error: e.message });
    }
  }

  async function deleteSelected() {
    if (!selected.size) return;
    const ok = await confirm({
      title: `Delete ${selected.size} row${selected.size > 1 ? "s" : ""}?`,
      body: `This permanently removes them from ${table.schema}.${table.name}.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const d = await mutate({ action: "delete", keys: [...selected].map((i) => rowKey(data.rows[i])) });
      flash(`Deleted ${d.rowCount} row(s)`);
      load();
    } catch (e) {
      setError({ error: e.message });
    }
  }

  function toggleSort(col) {
    setPage(1);
    setSort((s) => (s?.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null));
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="dataview view">
      {loading && data && <Progress />}
      <div className="toolbar">
        <form
          className="where"
          onSubmit={(e) => { e.preventDefault(); setPage(1); setWhere(whereInput); }}
        >
          <span className="kw">WHERE</span>
          <input
            className="input mono"
            placeholder={`e.g. ${data?.columns[0]?.name ?? "id"} > 10`}
            value={whereInput}
            onChange={(e) => setWhereInput(e.target.value)}
          />
          {where && <button type="button" className="btn" onClick={() => { setWhereInput(""); setWhere(""); setPage(1); }}>Clear</button>}
        </form>
        <div className="spacer" />
        {canEdit && <button className="btn" onClick={() => setInserting(true)}>+ Row</button>}
        {canEdit && selected.size > 0 && (
          <button className="btn danger" onClick={deleteSelected}>Delete {selected.size}</button>
        )}
        <button className="btn icon" title="Reload" onClick={load}>{loading ? <Spinner /> : "↻"}</button>
      </div>

      {data && !data.editable && <div className="muted small notice">Read-only: {table.kind}</div>}
      {data?.keyMode === "ctid" && <div className="muted small notice">No primary key — rows are identified by ctid.</div>}
      {error && (
        <div className="err banner" onClick={() => setError(null)}>
          {error.error}{error.detail && <div className="small">{error.detail}</div>}
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}
      {!data && loading && <div className="pad"><Skeleton rows={12} widths={[96, 92, 95, 90, 94, 91]} /></div>}

      {data && (
        <div className={`grid-wrap ${loading ? "loading" : ""}`}>
          <table className="grid">
            <thead>
              <tr>
                {canEdit ? (
                  <th className="rownum">
                    <input
                      type="checkbox"
                      checked={data.rows.length > 0 && selected.size === data.rows.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(data.rows.map((_, i) => i)) : new Set())}
                    />
                  </th>
                ) : <th className="rownum">#</th>}
                {data.columns.map((c) => (
                  <th key={c.name} onClick={() => toggleSort(c.name)} className="sortable" title={`${c.type}${c.nullable ? "" : " not null"}${c.default ? ` default ${c.default}` : ""}`}>
                    <div className="th">
                      <span>{c.pk && <span className="pk">🔑</span>}{c.name}</span>
                      <span className="type">{c.type}</span>
                      {sort?.col === c.name && <span className="sort">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, r) => (
                <tr key={r} className={selected.has(r) ? "sel" : ""}>
                  {canEdit ? (
                    <td className="rownum">
                      <input
                        type="checkbox"
                        checked={selected.has(r)}
                        onChange={() => setSelected((s) => { const n = new Set(s); n.has(r) ? n.delete(r) : n.add(r); return n; })}
                      />
                    </td>
                  ) : <td className="rownum">{(page - 1) * pageSize + r + 1}</td>}
                  {data.columns.map((col, c) => (
                    <td
                      key={c}
                      className={canEdit ? "editable" : ""}
                      onDoubleClick={() => canEdit && setEditing({ r, c, value: row[c] })}
                    >
                      {editing?.r === r && editing?.c === c ? (
                        <CellEditor initial={row[c]} nullable={col.nullable} onSave={saveEdit} onCancel={() => setEditing(null)} />
                      ) : (
                        <CellValue value={row[c]} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!data.rows.length && <div className="empty">No rows</div>}
        </div>
      )}

      {data && (
        <footer className="pager">
          <span className="muted small">
            {data.exact ? "" : "~"}{data.total.toLocaleString()} rows
            {canEdit && " · double-click a cell to edit"}
          </span>
          <div className="spacer" />
          <Select
            size="sm"
            value={pageSize}
            options={PAGE_SIZES.map((n) => ({ value: n, label: `${n} / page` }))}
            onChange={(n) => { setPageSize(n); setPage(1); }}
          />
          <button className="btn" disabled={page <= 1} onClick={() => setPage(1)}>«</button>
          <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span className="small">Page {page} of {pages.toLocaleString()}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
          <button className="btn" disabled={page >= pages || !data.exact} onClick={() => setPage(pages)}>»</button>
        </footer>
      )}

      {inserting && data && (
        <InsertDialog
          columns={data.columns}
          onClose={() => setInserting(false)}
          onSubmit={async (values) => {
            await mutate({ action: "insert", values });
            setInserting(false);
            flash("Row inserted");
            load();
          }}
        />
      )}
    </div>
  );
}

function CellEditor({ initial, nullable, onSave, onCancel }) {
  const [v, setV] = useState(initial ?? "");
  const multiline = String(initial ?? "").length > 60 || String(initial ?? "").includes("\n");
  const keys = (e) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(v); }
  };
  const Field = multiline ? "textarea" : "input";
  return (
    <div className="cell-editor">
      <Field autoFocus className="input mono" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={keys} rows={multiline ? 5 : undefined} />
      <div className="cell-actions">
        <button className="btn sm primary" onClick={() => onSave(v)}>Save</button>
        {nullable && <button className="btn sm" onClick={() => onSave(null)}>NULL</button>}
        <button className="btn sm" onClick={onCancel}>Esc</button>
      </div>
    </div>
  );
}

function InsertDialog({ columns, onClose, onSubmit }) {
  // mode per column: "default" (omit), "value", "null"
  const [vals, setVals] = useState(() =>
    Object.fromEntries(columns.map((c) => [c.name, { mode: c.default ? "default" : "value", v: "" }]))
  );
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (name, patch) => setVals((s) => ({ ...s, [name]: { ...s[name], ...patch } }));

  async function submit(e) {
    e.preventDefault();
    const values = {};
    for (const c of columns) {
      const { mode, v } = vals[c.name];
      if (mode === "null") values[c.name] = null;
      else if (mode === "value") values[c.name] = v; // "default" -> omitted
    }
    setBusy(true);
    try { await onSubmit(values); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal as="form" onClose={onClose} onSubmit={submit}>
      {(close) => (<>
        <h3>Insert row</h3>
        <div className="fields">
          {columns.map((c) => {
            const s = vals[c.name];
            return (
              <label key={c.name} className="field">
                <span className="fname">{c.pk && "🔑 "}{c.name} <span className="type">{c.type}</span></span>
                <div className="row gap">
                  <input
                    className="input mono"
                    disabled={s.mode !== "value"}
                    placeholder={s.mode === "default" ? `DEFAULT ${c.default}` : s.mode === "null" ? "NULL" : ""}
                    value={s.mode === "value" ? s.v : ""}
                    onChange={(e) => set(c.name, { v: e.target.value })}
                  />
                  <Select
                    size="sm"
                    className="mode-select"
                    value={s.mode}
                    options={[
                      { value: "value", label: "value" },
                      ...(c.default ? [{ value: "default", label: "default" }] : []),
                      ...(c.nullable ? [{ value: "null", label: "null" }] : []),
                    ]}
                    onChange={(mode) => set(c.name, { mode })}
                  />
                </div>
              </label>
            );
          })}
        </div>
        {err && <div className="err banner">{err}</div>}
        <div className="row gap end">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? <><Spinner size={12} /> Inserting…</> : "Insert"}</button>
        </div>
      </>)}
    </Modal>
  );
}
