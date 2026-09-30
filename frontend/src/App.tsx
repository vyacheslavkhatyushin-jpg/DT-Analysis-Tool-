import { Center, Loader } from '@mantine/core'
import { createBrowserRouter, RouterProvider } from 'react-router'

import { AuthProvider } from './auth/AuthProvider'
import { LoginPage } from './auth/LoginPage'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './layout/AppLayout'

// Pages load on demand: tables and KPI do not wait for the map engine (MapLibre) and vice versa.
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    HydrateFallback: PageLoader,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./pages/MapPage')).MapPage }) },
      {
        path: 'sites',
        lazy: async () => ({ Component: (await import('./pages/SitesPage')).SitesPage }),
      },
      {
        path: 'enodebs',
        lazy: async () => ({ Component: (await import('./pages/ENodeBsPage')).ENodeBsPage }),
      },
      {
        path: 'cells',
        lazy: async () => ({ Component: (await import('./pages/CellsPage')).CellsPage }),
      },
      { path: 'kpi', lazy: async () => ({ Component: (await import('./pages/KpiPage')).KpiPage }) },
      {
        path: 'drive',
        lazy: async () => ({ Component: (await import('./pages/DrivePage')).DrivePage }),
      },
      {
        path: 'drive/:id',
        lazy: async () => ({
          Component: (await import('./pages/DriveSessionPage')).DriveSessionPage,
        }),
      },
      {
        path: 'assets',
        lazy: async () => ({ Component: (await import('./pages/AssetsPage')).AssetsPage }),
      },
      {
        path: 'devices',
        lazy: async () => ({ Component: (await import('./pages/DevicesPage')).DevicesPage }),
      },
      {
        path: 'import',
        lazy: async () => ({ Component: (await import('./pages/ImportPage')).ImportPage }),
      },
      {
        path: 'changes',
        lazy: async () => ({ Component: (await import('./pages/ChangesPage')).ChangesPage }),
      },
      {
        path: 'users',
        lazy: async () => ({ Component: (await import('./pages/UsersPage')).UsersPage }),
      },
    ],
  },
])

function PageLoader() {
  return (
    <Center h="100vh">
      <Loader size="sm" />
    </Center>
  )
}

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
