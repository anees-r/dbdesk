"use client";

export function CellValue({ value }) {
  if (value === null) return <span className="null">NULL</span>;
  const s = String(value);
  return <span title={s.length > 80 ? s : undefined}>{s.length > 200 ? s.slice(0, 200) + "…" : s}</span>;
}

export function ResultGrid({ columns, rows }) {
  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="rownum">#</th>
            {columns.map((c, i) => <th key={i}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="rownum">{i + 1}</td>
              {r.map((v, j) => <td key={j}><CellValue value={v} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
