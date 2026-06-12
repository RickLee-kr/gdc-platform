import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { NAV_PATH } from '../../config/nav-paths'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

/** Catches render errors in route outlets so the shell (sidebar/header) stays visible. */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RouteErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <section
          role="alert"
          aria-label="Page error"
          className="rounded-xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-500/35 dark:bg-gdc-card"
          data-testid="route-error-boundary"
        >
          <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">This page failed to load</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-gdc-muted">
            Try a hard refresh (Ctrl+Shift+R). If the problem continues, return to Streams and open monitoring again.
          </p>
          <p className="mt-3 font-mono text-[11px] text-red-700/90 dark:text-red-300/90">{error.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
            >
              Retry
            </button>
            <Link
              to={NAV_PATH.streams}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700"
            >
              Back to Streams
            </Link>
          </div>
        </section>
      )
    }
    return this.props.children
  }
}
