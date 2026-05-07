import type { ReactElement } from 'react'

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function StatGrid({ title, data }: { title: string; data: Record<string, unknown> | null | undefined }): ReactElement {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="obs-block">
        <h3>{title}</h3>
        <p className="muted">No data</p>
      </div>
    )
  }
  return (
    <div className="obs-block">
      <h3>{title}</h3>
      <dl className="stat-grid">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="stat-row">
            <dt>{k}</dt>
            <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function RowsTable({
  title,
  rows,
}: {
  title: string
  rows: unknown[] | null | undefined
}): ReactElement {
  if (!rows || rows.length === 0) {
    return (
      <div className="obs-block">
        <h3>{title}</h3>
        <p className="muted">No rows</p>
      </div>
    )
  }
  const first = rows[0]
  const cols = isRecord(first) ? Object.keys(first) : ['value']
  return (
    <div className="obs-block">
      <h3>{title}</h3>
      <div className="obs-table-wrap">
        <table className="obs-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c}>
                    {(() => {
                      if (!isRecord(row)) {
                        return String(row)
                      }
                      const cell = row[c]
                      if (cell === null || cell === undefined) {
                        return '—'
                      }
                      if (typeof cell === 'object') {
                        return JSON.stringify(cell)
                      }
                      return String(cell)
                    })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function JsonBlock({ title, value }: { title: string; value: unknown }): ReactElement {
  return (
    <div className="obs-block">
      <h3>{title}</h3>
      <pre className="obs-json">{JSON.stringify(value ?? null, null, 2)}</pre>
    </div>
  )
}
