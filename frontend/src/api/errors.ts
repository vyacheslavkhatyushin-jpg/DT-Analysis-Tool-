export class ApiError extends Error {
  readonly status: number
  readonly field: string | null

  constructor(status: number, message: string, field: string | null = null) {
    super(message)
    this.status = status
    this.field = field
  }
}

export type ErrorBody = {
  detail?: string | { loc?: (string | number)[]; msg?: string }[]
  field?: string | null
}

export function errorMessage(body: unknown, status: number): string {
  const detail = (body as ErrorBody | undefined)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const field = (e.loc ?? []).filter((p) => p !== 'body').join('.')
        const msg = (e.msg ?? '').replace(/^Value error, /, '')
        return field ? `${field}: ${msg}` : msg
      })
      .join('; ')
  }
  return `Ошибка сервера (${status})`
}
