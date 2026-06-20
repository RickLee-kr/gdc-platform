import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  RouteDeployReadinessBadge,
  RouteProcessingDeliveryBadge,
  RouteProcessingDeployModeBadge,
  RouteProcessingStatusBadge,
} from './route-processing-status-badge'

describe('RouteProcessingStatusBadge', () => {
  it('renders Shared badge for Inherited status', () => {
    render(<RouteProcessingStatusBadge status="Inherited" />)
    expect(screen.getByTestId('route-processing-status-inherited')).toHaveTextContent('Shared')
  })

  it('renders Override badge for Overridden status', () => {
    render(<RouteProcessingStatusBadge status="Overridden" />)
    expect(screen.getByTestId('route-processing-status-overridden')).toHaveTextContent('Override')
  })

  it('renders Mixed badge with warning styling label', () => {
    render(<RouteProcessingStatusBadge status="Mixed" />)
    expect(screen.getByTestId('route-processing-status-mixed')).toHaveTextContent('Mixed')
  })
})

describe('RouteProcessingDeployModeBadge', () => {
  it('renders Shared and Override deploy mode labels', () => {
    const { rerender } = render(<RouteProcessingDeployModeBadge mode="shared" />)
    expect(screen.getByTestId('route-processing-deploy-mode-shared')).toHaveTextContent('Shared')
    rerender(<RouteProcessingDeployModeBadge mode="override" />)
    expect(screen.getByTestId('route-processing-deploy-mode-override')).toHaveTextContent('Override')
  })
})

describe('RouteProcessingDeliveryBadge', () => {
  it('renders Enabled and Disabled delivery labels', () => {
    const { rerender } = render(<RouteProcessingDeliveryBadge enabled />)
    expect(screen.getByTestId('route-card-delivery-status')).toHaveTextContent('Enabled')
    rerender(<RouteProcessingDeliveryBadge enabled={false} />)
    expect(screen.getByTestId('route-card-delivery-status')).toHaveTextContent('Disabled')
  })
})

describe('RouteDeployReadinessBadge', () => {
  it('renders deploy readiness status labels', () => {
    const { rerender } = render(<RouteDeployReadinessBadge status="ready" />)
    expect(screen.getByTestId('route-deploy-readiness-ready')).toHaveTextContent('Ready')
    rerender(<RouteDeployReadinessBadge status="warning" />)
    expect(screen.getByTestId('route-deploy-readiness-warning')).toHaveTextContent('Warning')
    rerender(<RouteDeployReadinessBadge status="error" />)
    expect(screen.getByTestId('route-deploy-readiness-error')).toHaveTextContent('Needs Attention')
  })
})
