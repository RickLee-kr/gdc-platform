import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuditLogsPage } from './audit-logs-page'

vi.mock('../../api/gdcAudit', () => ({
  listAuditLogs: vi.fn(() =>
    Promise.resolve({
      total: 1,
      items: [
        {
          id: 1,
          created_at: '2026-05-21T12:00:00Z',
          actor_user_id: 2,
          actor_username: 'op-1',
          action: 'USER_LOGIN',
          entity_type: 'PLATFORM_USER',
          entity_id: 2,
          result: 'success',
          ip_address: '127.0.0.1',
          user_agent: 'test',
          metadata_json: { role: 'OPERATOR' },
          summary: 'USER_LOGIN PLATFORM_USER#2 "op-1"',
        },
      ],
    }),
  ),
}))

describe('AuditLogsPage', () => {
  it('renders audit table rows from API', async () => {
    render(<AuditLogsPage />)
    const table = await screen.findByTestId('audit-logs-table')
    expect(table).toBeInTheDocument()
    expect(screen.getByText('USER_LOGIN')).toBeInTheDocument()
    expect(screen.getByText('op-1')).toBeInTheDocument()
    expect(table.querySelector('tbody')?.textContent).toContain('success')
  })
})
