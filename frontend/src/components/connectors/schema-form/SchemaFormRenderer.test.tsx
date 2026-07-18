import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SchemaFormRenderer } from './SchemaFormRenderer'
import type { GdcAuthSchema } from './schema-form-types'
import { validateSchemaForm } from './schema-form-validation'

const bearerSchema: GdcAuthSchema = {
  type: 'bearer',
  fields: [
    { name: 'base_url', label: 'API Base URL', required: true },
    { name: 'bearer_token', label: 'Bearer Token', required: true, secret: true },
  ],
}

const apiKeySchema: GdcAuthSchema = {
  type: 'api_key',
  fields: [
    { name: 'base_url', label: 'Domain', required: true },
    { name: 'api_key_name', label: 'Header Name', required: true, default: 'Authorization' },
    { name: 'api_key_value', label: 'API Token', required: true, secret: true },
    {
      name: 'api_key_location',
      label: 'Key Location',
      type: 'select',
      enum: ['headers', 'query_params'],
      required: true,
      default: 'headers',
    },
  ],
}

const oauthSchema: GdcAuthSchema = {
  type: 'oauth2_client_credentials',
  fields: [
    { name: 'oauth2_client_id', label: 'Client ID', required: true },
    { name: 'oauth2_client_secret', label: 'Client Secret', required: true, secret: true },
    { name: 'oauth2_token_url', label: 'Token URL', required: true },
  ],
}

describe('SchemaFormRenderer', () => {
  it('renders bearer fields', () => {
    render(
      <SchemaFormRenderer
        schema={bearerSchema}
        values={{ base_url: 'https://api.example.com' }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByTestId('schema-form-renderer')).toBeInTheDocument()
    expect(screen.getByTestId('schema-field-base_url')).toBeInTheDocument()
    expect(screen.getByTestId('schema-field-bearer_token')).toHaveAttribute('type', 'password')
  })

  it('renders api_key fields with select enum', () => {
    render(
      <SchemaFormRenderer
        schema={apiKeySchema}
        values={{ api_key_location: 'headers' }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByTestId('schema-field-api_key_location')).toBeInTheDocument()
    expect(screen.getByTestId('schema-field-api_key_value')).toHaveAttribute('type', 'password')
  })

  it('renders oauth2_client_credentials fields', () => {
    render(
      <SchemaFormRenderer
        schema={oauthSchema}
        values={{}}
        onChange={() => {}}
      />,
    )
    expect(screen.getByTestId('schema-field-oauth2_client_id')).toBeInTheDocument()
    expect(screen.getByTestId('schema-field-oauth2_client_secret')).toHaveAttribute('type', 'password')
    expect(screen.getByTestId('schema-field-oauth2_token_url')).toBeInTheDocument()
  })

  it('associates labels and wires validation errors to fields', () => {
    const errors = validateSchemaForm(bearerSchema, { base_url: 'https://api.example.com' })
    expect(errors).toEqual([{ field: 'bearer_token', message: 'Bearer Token is required.' }])

    render(
      <SchemaFormRenderer
        schema={bearerSchema}
        values={{ base_url: 'https://api.example.com' }}
        errors={errors}
        onChange={() => {}}
      />,
    )
    const token = screen.getByTestId('schema-field-bearer_token')
    expect(screen.getByLabelText(/Bearer Token/)).toBe(token)
    expect(token).toHaveAttribute('aria-invalid', 'true')
    expect(token).toHaveAttribute('aria-required', 'true')
    const error = screen.getByTestId('schema-error-bearer_token')
    expect(error).toHaveTextContent('Bearer Token is required.')
    expect(token.getAttribute('aria-describedby') ?? '').toContain(error.id)
  })

  it('does not use the field label as placeholder', () => {
    render(
      <SchemaFormRenderer
        schema={bearerSchema}
        values={{}}
        onChange={() => {}}
      />,
    )
    expect(screen.getByTestId('schema-field-base_url')).not.toHaveAttribute('placeholder', 'API Base URL')
  })

  it('calls onChange when a field is edited', () => {
    const onChange = vi.fn()
    render(
      <SchemaFormRenderer
        schema={bearerSchema}
        values={{}}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByTestId('schema-field-base_url'), {
      target: { value: 'https://api.crowdstrike.com' },
    })
    expect(onChange).toHaveBeenCalledWith({ base_url: 'https://api.crowdstrike.com' })
  })
})

describe('schema error fallback', () => {
  it('normalizeAuthSchema returns error for invalid schema root', async () => {
    const { normalizeAuthSchema } = await import('./schema-form-normalize')
    const result = normalizeAuthSchema(null)
    expect(result.schema).toBeNull()
    expect(result.error).toMatch(/JSON object/)
  })
})
