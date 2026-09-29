import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo } from 'react'

import { api, ApiError, type Schemas, UNAUTHORIZED_EVENT, unwrap } from '../api/client'
import { AuthContext, type AuthContextValue } from './context'

type User = Schemas['UserRead']

const ME = ['me']

async function fetchMe(): Promise<User | null> {
  try {
    return await unwrap(api.GET('/api/v1/auth/me'))
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data: user = null, isPending } = useQuery({
    queryKey: ME,
    queryFn: fetchMe,
    retry: false,
  })

  useEffect(() => {
    const onUnauthorized = () => queryClient.setQueryData(ME, null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading: isPending,
      canEdit: user?.role === 'admin' || user?.role === 'engineer',
      isAdmin: user?.role === 'admin',
      login: async (username, password) => {
        const result = await unwrap(
          api.POST('/api/v1/auth/login', { body: { username, password } }),
        )
        queryClient.setQueryData(ME, result.user)
      },
      logout: async () => {
        await api.POST('/api/v1/auth/logout')
        queryClient.clear()
        queryClient.setQueryData(ME, null)
      },
    }),
    [user, isPending, queryClient],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
