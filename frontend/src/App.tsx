import { createBrowserRouter, RouterProvider } from 'react-router'

import { AuthProvider } from './auth/AuthProvider'
import { LoginPage } from './auth/LoginPage'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './layout/AppLayout'
import { AssetsPage } from './pages/AssetsPage'
import { CellsPage } from './pages/CellsPage'
import { ChangesPage } from './pages/ChangesPage'
import { DevicesPage } from './pages/DevicesPage'
import { ENodeBsPage } from './pages/ENodeBsPage'
import { ImportPage } from './pages/ImportPage'
import { MapPage } from './pages/MapPage'
import { SitesPage } from './pages/SitesPage'
import { UsersPage } from './pages/UsersPage'

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <MapPage /> },
      { path: 'sites', element: <SitesPage /> },
      { path: 'enodebs', element: <ENodeBsPage /> },
      { path: 'cells', element: <CellsPage /> },
      { path: 'assets', element: <AssetsPage /> },
      { path: 'devices', element: <DevicesPage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'changes', element: <ChangesPage /> },
      { path: 'users', element: <UsersPage /> },
    ],
  },
])

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
