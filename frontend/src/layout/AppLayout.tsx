import { AppShell, Group, Menu, NavLink, Stack, Text, UnstyledButton } from '@mantine/core'
import {
  IconAntenna,
  IconAntennaBars5,
  IconBuildingBroadcastTower,
  IconChevronDown,
  IconDeviceMobile,
  IconFileSpreadsheet,
  IconHistory,
  IconKey,
  IconLogout,
  IconMap2,
  IconTruck,
  IconUsers,
  IconWifi,
} from '@tabler/icons-react'
import { useState } from 'react'
import { NavLink as RouterNavLink, Outlet } from 'react-router'

import { useAuth } from '../auth/context'
import { ROLE_LABELS } from '../labels'
import { PasswordModal } from './PasswordModal'

const NAV = [
  { to: '/', label: 'Карта', icon: IconMap2 },
  { to: '/sites', label: 'Сайты', icon: IconBuildingBroadcastTower },
  { to: '/enodebs', label: 'eNodeB', icon: IconAntenna },
  { to: '/cells', label: 'Соты', icon: IconWifi },
  { to: '/assets', label: 'Техника', icon: IconTruck },
  { to: '/devices', label: 'Устройства', icon: IconDeviceMobile },
  { to: '/import', label: 'Импорт и экспорт', icon: IconFileSpreadsheet },
  { to: '/changes', label: 'Журнал изменений', icon: IconHistory },
]

export function AppLayout() {
  const { user, isAdmin, logout } = useAuth()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const items = isAdmin ? [...NAV, { to: '/users', label: 'Пользователи', icon: IconUsers }] : NAV

  return (
    <AppShell header={{ height: 48 }} navbar={{ width: 220, breakpoint: 'sm' }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <IconAntennaBars5 size={22} stroke={1.5} />
            <Text fw={700}>DT Analysis Tool</Text>
            <Text size="sm" c="dimmed">
              частная LTE-сеть
            </Text>
          </Group>
          <Menu position="bottom-end" width={200}>
            <Menu.Target>
              <UnstyledButton>
                <Group gap={4}>
                  <Stack gap={0} align="flex-end">
                    <Text size="sm" fw={500}>
                      {user?.full_name ?? user?.username}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {user ? ROLE_LABELS[user.role] : ''}
                    </Text>
                  </Stack>
                  <IconChevronDown size={14} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconKey size={14} />} onClick={() => setPasswordOpen(true)}>
                Сменить пароль
              </Menu.Item>
              <Menu.Item leftSection={<IconLogout size={14} />} onClick={() => void logout()}>
                Выйти
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {items.map((item) => (
          <NavLink
            key={item.to}
            component={RouterNavLink}
            to={item.to}
            end={item.to === '/'}
            label={item.label}
            leftSection={<item.icon size={18} stroke={1.5} />}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main h="100dvh">
        <div style={{ height: 'calc(100dvh - 48px)' }}>
          <Outlet />
        </div>
      </AppShell.Main>
      <PasswordModal opened={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </AppShell>
  )
}
