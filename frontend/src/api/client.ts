import createClient, { type Middleware } from 'openapi-fetch'

import { ApiError, type ErrorBody, errorMessage } from './errors'
import type { components, paths } from './schema'

export { ApiError } from './errors'

export type Schemas = components['schemas']

export const UNAUTHORIZED_EVENT = 'dtat:unauthorized'

// A 401 outside of the auth endpoints means the session has expired.
const sessionWatcher: Middleware = {
  onResponse({ response, request }) {
    if (response.status === 401 && !new URL(request.url).pathname.startsWith('/api/v1/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    return response
  },
}

export const api = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: 'same-origin',
})
api.use(sessionWatcher)

type FetchResult<T> = { data?: T; error?: unknown; response: Response }

/** Returns the response data or throws an ApiError with a user-facing message. */
export async function unwrap<T>(request: Promise<FetchResult<T>>): Promise<T> {
  const { data, error, response } = await request
  if (!response.ok) {
    const field = (error as ErrorBody | undefined)?.field ?? null
    throw new ApiError(response.status, errorMessage(error, response.status), field)
  }
  return data as T
}
