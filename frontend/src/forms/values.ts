import { ApiError } from '../api/client'
import { notifyError } from '../components/confirm'

export type NumberValue = number | string

/** NumberInput gives '' for an empty field: the API expects null. */
export function num(value: NumberValue): number | null {
  if (value === '' || value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function numOrEmpty(value: number | null | undefined): NumberValue {
  return value ?? ''
}

export function text(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Mantine date pickers return local "YYYY-MM-DD HH:mm:ss"; the API wants ISO 8601 with a zone. */
export function toIso(value: string | null): string | null {
  if (!value) return null
  return new Date(value.replace(' ', 'T')).toISOString()
}

type FieldErrorSetter = { setFieldError: (path: string, error: string) => void }

/** Show a server error next to its field when the API names one, otherwise as a notification. */
export function handleSubmitError(form: FieldErrorSetter, error: unknown, fields: string[]) {
  if (error instanceof ApiError && error.field && fields.includes(error.field)) {
    form.setFieldError(error.field, error.message)
  } else {
    notifyError(error)
  }
}
