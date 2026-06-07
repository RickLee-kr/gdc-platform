import { Navigate, useLocation } from 'react-router-dom'

/** SPA redirect that keeps query string and hash (M17.1 URL migration). */
export function PreserveSearchRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation()
  return <Navigate to={`${to}${search}${hash}`} replace />
}
