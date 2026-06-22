import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RouteProcessingDetailHeader } from './route-processing-detail-header'
import { ROUTE_PROCESSING_COPY } from './route-processing-labels'

describe('RouteProcessingDetailHeader', () => {
  it('shows route and destination labels', () => {
    render(<RouteProcessingDetailHeader routeLabel="MSS Syslog" destinationLabel="Splunk HEC" />)
    expect(screen.getByTestId('route-processing-detail-header')).toBeInTheDocument()
    expect(screen.getByText('MSS Syslog')).toBeInTheDocument()
    expect(screen.getByText('Route Workspace')).toBeInTheDocument()
    expect(screen.getByTestId('route-detail-destination')).toHaveTextContent('Destination: Splunk HEC')
  })

  it('shows destination missing warning', () => {
    render(<RouteProcessingDetailHeader routeLabel="Route A" destinationMissing />)
    expect(screen.getByTestId('route-destination-missing-warning')).toHaveTextContent(
      ROUTE_PROCESSING_COPY.destinationMissing,
    )
    expect(screen.getByTestId('route-destination-missing-warning')).toHaveTextContent(
      ROUTE_PROCESSING_COPY.destinationMissingHint,
    )
  })
})
