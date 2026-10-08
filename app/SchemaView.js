"use client";

import { useEffect, useMemo, useState } from "react";
import { Progress, Skeleton, Spinner } from "./ui";

const CONSTRAINT = { p: "primary key", u: "unique", f: "foreign key", c: "check", x: "exclusion", t: "trigger" };

function useSchema(db, table) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    const q = new URLSearchParams({ server: db.server, db: db.database, ...(table && { schema: table.schema, table: table.name }) });
    fetch(`/api/schema?${q}`)
      .then((r) => r.json())
      .then((d) => live && setState({ data: d.error ? null : d, error: d.error ?? null, loading: false }))
      .catch((e) => live && setState({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
  }, [db, table, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Table structure when `table` is set, otherwise an overview of the whole database. */
export default function SchemaView({ db, table, onOpen }) {
  return table ? <TableStructure db={db} table={table} onOpen={onOpen} /> : <Overview db={db} onOpen={onOpen} />;
}

/* ---------- whole-database overview ---------- */

function Overview({ db, onOpen }) {
  const { data, error, loading, reload } = useSchema(db, null);
  const [filter, setFilter] = useState("");
  const [hover, setHover] = useState(null); // "schema.table"

  const key = (s, t) => `${s}.${t}`;
  // tables linked to the hovered one, in either direction
  const related = useMemo(() => {
    if (!hover || !data) return new Set();
    const out = new Set([hover]);
    for (const t of data.tables) for (const fk of t.fks) {
      const from = key(fk.schema, fk.table), to = key(fk.ref_schema, fk.ref_table);
      if (from === hover) out.add(to);
      if (to === hover) out.add(from);
    }
    return out;
  }, [hover, data]);

  const tables = useMemo(() => {
    const f = filter.toLowerCase();
    return (data?.tables ?? []).filter((t) => !f || key(t.schema, t.name).toLowerCase().includes(f) || t.columns.some((c) => c.name.toLowerCase().includes(f)));
  }, [data, filter]);

  const fkCount = data?.tables.reduce((n, t) => n + t.fks.length, 0) ?? 0;

  return (
    <div className="schema-view view">
      {loading && data && <Progress />}
      <div className="toolbar">
        <input className="input schema-filter" placeholder="Filter tables or columns…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {data && <span className="muted small">{data.tables.length} relations · {fkCount} foreign keys · hover a table to see its links</span>}
        <div className="spacer" />
        <button className="btn icon" title="Reload" onClick={reload}>{loading ? <Spinner /> : "↻"}</button>
      </div>
      {error && <div className="err banner">{error}</div>}
      {!data && loading && <div className="pad"><Skeleton rows={8} /></div>}
      {data && (
        <div className={`er-grid ${hover ? "focusing" : ""}`}>
          {tables.map((t, i) => {
            const k = key(t.schema, t.name);
            const fkCols = new Map(t.fks.flatMap((fk) => fk.columns.map((c) => [c, fk])));
            return (
              <div
                key={k}
                className={`er-card ${related.has(k) ? "related" : ""} ${hover === k ? "hovered" : ""}`}
                style={{ animationDelay: `${Math.min(i, 30) * 18}ms` }}
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover(null)}
              >
                <button className="er-head" onClick={() => onOpen(t, "structure")} title="Open structure">
                  <span className={`kind kind-${t.kind}`}>{t.kind[0]}</span>
                  <span className="tname">{t.schema !== "public" && <span className="muted">{t.schema}.</span>}{t.name}</span>
                </button>
                <ul className="er-cols">
                  {t.columns.map((c) => {
                    const fk = fkCols.get(c.name);
                    return (
                      <li key={c.name} className={c.pk ? "pk-col" : ""}>
                        <span className="er-mark">{c.pk ? "🔑" : fk ? "↗" : ""}</span>
                        <span className="er-name">{c.name}</span>
                        <span className="type">{c.type}{c.nullable ? "" : " !"}</span>
                        {fk && (
                          <button className="er-link" title={`references ${fk.ref_schema}.${fk.ref_table}`}
                            onClick={() => onOpen({ schema: fk.ref_schema, name: fk.ref_table, kind: "table" }, "structure")}>
                            {fk.ref_table}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {!tables.length && <div className="empty">No tables match.</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- single table structure ---------- */

function TableStructure({ db, table, onOpen }) {
  const { data: t, error, loading, reload } = useSchema(db, table);
  const [copied, setCopied] = useState(false);

  async function copyDdl() {
    await navigator.clipboard.writeText(t.ddl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const open = (schema, name) => onOpen({ schema, name, kind: "table" }, "structure");

  return (
    <div className="schema-view view">
      {loading && t && <Progress />}
      <div className="toolbar">
        <button className="btn sm" onClick={() => onOpen(null, "structure")}>← All tables</button>
        {t && (
          <div className="stats">
            <span className={`kind kind-${t.kind}`}>{t.kind[0]}</span>
            <span><b>{t.columns.length}</b> columns</span>
            {t.kind === "table" && <span>~<b>{Number(t.estimate).toLocaleString()}</b> rows</span>}
            <span><b>{t.total_size}</b> total</span>
            {t.indexes.length > 0 && <span><b>{t.indexes.length}</b> indexes</span>}
          </div>
        )}
        <div className="spacer" />
        <button className="btn sm" onClick={() => onOpen(table, "data")}>View data</button>
        <button className="btn icon" title="Reload" onClick={reload}>{loading ? <Spinner /> : "↻"}</button>
      </div>
      {error && <div className="err banner">{error}</div>}
      {!t && loading && <div className="pad"><Skeleton rows={10} /></div>}
      {t && (
        <div className="structure">
          {t.comment && <p className="muted comment">{t.comment}</p>}

          <Section title="Columns" count={t.columns.length}>
            <table className="grid struct">
              <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Nullable</th><th>Default</th><th>Notes</th></tr></thead>
              <tbody>
                {t.columns.map((c, i) => (
                  <tr key={c.name}>
                    <td className="muted">{i + 1}</td>
                    <td>{c.pk && <span className="pk">🔑</span>}<b className="colname">{c.name}</b></td>
                    <td className="type-cell">{c.type}</td>
                    <td>{c.nullable ? <span className="muted">yes</span> : <span className="badge">not null</span>}</td>
                    <td className="muted">{c.generated ? "" : c.default ?? ""}</td>
                    <td>
                      {c.identity && <span className="badge">identity</span>}
                      {c.generated && <span className="badge" title={c.default}>generated</span>}
                      {c.fk && (
                        <button className="er-link" onClick={() => open(c.fk.ref_schema, c.fk.ref_table)}>
                          → {c.fk.ref_table}.{c.fk.ref_column}
                        </button>
                      )}
                      {c.comment && <span className="muted"> {c.comment}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {t.indexes.length > 0 && (
            <Section title="Indexes" count={t.indexes.length}>
              <table className="grid struct">
                <thead><tr><th>Name</th><th>Definition</th><th>Size</th></tr></thead>
                <tbody>
                  {t.indexes.map((i) => (
                    <tr key={i.name}>
                      <td>
                        <b className="colname">{i.name}</b>
                        {i.primary ? <span className="badge accent">primary</span> : i.unique && <span className="badge">unique</span>}
                      </td>
                      <td className="muted wrap">{i.def}</td>
                      <td className="muted">{i.size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {t.constraints.length > 0 && (
            <Section title="Constraints" count={t.constraints.length}>
              <table className="grid struct">
                <thead><tr><th>Name</th><th>Type</th><th>Definition</th></tr></thead>
                <tbody>
                  {t.constraints.map((c) => (
                    <tr key={c.name}>
                      <td><b className="colname">{c.name}</b></td>
                      <td><span className={`badge ${c.type === "p" ? "accent" : ""}`}>{CONSTRAINT[c.type] ?? c.type}</span></td>
                      <td className="muted wrap">{c.def}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {t.referencedBy.length > 0 && (
            <Section title="Referenced by" count={t.referencedBy.length}>
              <div className="refs">
                {t.referencedBy.map((r) => (
                  <button key={`${r.schema}.${r.table}.${r.name}`} className="ref-chip" onClick={() => open(r.schema, r.table)}>
                    <b>{r.schema !== "public" && `${r.schema}.`}{r.table}</b>
                    <span className="muted">({r.columns.join(", ")}) → ({r.ref_columns.join(", ")})</span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title="DDL" action={<button className="btn sm" onClick={copyDdl}>{copied ? "Copied ✓" : "Copy"}</button>}>
            <pre className="ddl">{t.ddl}</pre>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, action, children }) {
  return (
    <section className="struct-section">
      <div className="struct-head">
        <h4>{title}</h4>
        {count != null && <span className="count">{count}</span>}
        <div className="spacer" />
        {action}
      </div>
      {children}
    </section>
  );
}
