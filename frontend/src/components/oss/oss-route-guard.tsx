import { Navigate } from 'react-router-dom'
import { isInternalOperatorUiEnabled } from '../../lib/feature-flags'

type OssRouteGuardProps = {
  children: React.ReactNode
  redirectTo?: string
}

/** Redirects internal-only routes away from the OSS release surface. */
export function OssRouteGuard({ children, redirectTo = '/streams' }: OssRouteGuardProps) {
  if (!isInternalOperatorUiEnabled()) {
    return <Navigate to={redirectTo} replace />
  }
  return children
}
