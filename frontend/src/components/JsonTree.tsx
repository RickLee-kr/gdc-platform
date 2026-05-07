import type { ReactElement } from 'react'

export function JsonTree({
  value,
  basePath,
  onPickPath,
}: {
  value: unknown
  basePath: string
  onPickPath: (path: string) => void
}): ReactElement {
  if (value === null || typeof value !== 'object') {
    return (
      <button className="json-leaf" type="button" onClick={() => onPickPath(basePath)}>
        <span>{basePath}</span>
        <code>{String(value)}</code>
      </button>
    )
  }

  if (Array.isArray(value)) {
    return (
      <ul className="json-tree">
        {value.slice(0, 20).map((item, idx) => (
          <li key={`${basePath}[${idx}]`}>
            <JsonTree value={item} basePath={`${basePath}[${idx}]`} onPickPath={onPickPath} />
          </li>
        ))}
      </ul>
    )
  }

  const entries = Object.entries(value as Record<string, unknown>)
  return (
    <ul className="json-tree">
      {entries.map(([key, item]) => {
        const nextPath = basePath === '$' ? `$.${key}` : `${basePath}.${key}`
        return (
          <li key={nextPath}>
            <details open>
              <summary>
                <button className="path-pick" type="button" onClick={() => onPickPath(nextPath)}>
                  {nextPath}
                </button>
              </summary>
              <JsonTree value={item} basePath={nextPath} onPickPath={onPickPath} />
            </details>
          </li>
        )
      })}
    </ul>
  )
}
