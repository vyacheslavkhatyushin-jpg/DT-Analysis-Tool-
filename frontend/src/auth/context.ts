import { createContext, useContext } from 'react'

import type { Schemas } from '../api/client'

type User = Schemas['UserRead']

export type AuthContextValue = {
  user: User | null
  loading: boolean
  canEdit: boolean
  isAdmin: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
