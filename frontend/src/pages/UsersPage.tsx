import {
  Badge,
  Button,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Switch,
  TextInput,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import { type User, useUsers } from '../api/hooks'
import { notifySaved } from '../components/confirm'
import { type Column, DataTable } from '../components/DataTable'
import { EditAction } from '../components/RowActions'
import { FormButtons } from '../forms/common'
import { handleSubmitError, text } from '../forms/values'
import { formatDateTime, options, ROLE_LABELS } from '../labels'
import { Page } from './PageLayout'

const columns: Column<User>[] = [
  {
    key: 'username',
    header: 'Логин',
    value: (u) => u.username,
    render: (u) => <b>{u.username}</b>,
  },
  { key: 'full_name', header: 'Имя', value: (u) => u.full_name },
  { key: 'role', header: 'Роль', value: (u) => ROLE_LABELS[u.role] },
  {
    key: 'active',
    header: 'Статус',
    value: (u) => (u.is_active ? 'активен' : 'отключен'),
    render: (u) => (
      <Badge variant="light" color={u.is_active ? 'green' : 'gray'}>
        {u.is_active ? 'активен' : 'отключен'}
      </Badge>
    ),
  },
  {
    key: 'login',
    header: 'Последний вход',
    value: (u) => u.last_login_at,
    render: (u) => formatDateTime(u.last_login_at),
  },
]

export function UsersPage() {
  const users = useUsers()
  const [editing, setEditing] = useState<{ user: User | null } | null>(null)
  return (
    <Page
      title="Пользователи"
      description="Администратор управляет пользователями; инженер редактирует инвентарь; просмотр — только чтение."
      actions={
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ user: null })}>
          Добавить
        </Button>
      }
    >
      <DataTable
        rows={users.data}
        loading={users.isPending}
        columns={columns}
        rowKey={(u) => u.id}
        actions={(u) => <EditAction onClick={() => setEditing({ user: u })} />}
      />
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.user ? editing.user.username : 'Новый пользователь'}
      >
        {editing && <UserForm user={editing.user} onClose={() => setEditing(null)} />}
      </Modal>
    </Page>
  )
}

type Values = {
  username: string
  full_name: string
  role: User['role']
  is_active: boolean
  password: string
}

function UserForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const form = useForm<Values>({
    initialValues: {
      username: user?.username ?? '',
      full_name: user?.full_name ?? '',
      role: user?.role ?? 'viewer',
      is_active: user?.is_active ?? true,
      password: '',
    },
    validate: {
      username: (v) => (user || /^[A-Za-z0-9_.-]{2,64}$/.test(v) ? null : 'Латиница, цифры, _ . -'),
      password: (v) => (!v && user ? null : v.length >= 8 ? null : 'Не короче 8 символов'),
    },
  })
  const save = useMutation({
    mutationFn: async (values: Values) => {
      if (user) {
        return unwrap(
          api.PATCH('/api/v1/users/{user_id}', {
            params: { path: { user_id: user.id } },
            body: {
              full_name: text(values.full_name),
              role: values.role,
              is_active: values.is_active,
              password: values.password || null,
            },
          }),
        )
      }
      return unwrap(
        api.POST('/api/v1/users', {
          body: {
            username: values.username,
            full_name: text(values.full_name),
            role: values.role,
            password: values.password,
          },
        }),
      )
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
  return (
    <form
      onSubmit={form.onSubmit((values) =>
        save.mutate(values, {
          onSuccess: () => {
            notifySaved()
            onClose()
          },
          onError: (error) => handleSubmitError(form, error, ['username', 'password']),
        }),
      )}
    >
      <Stack>
        <TextInput
          label="Логин"
          required
          disabled={user !== null}
          {...form.getInputProps('username')}
        />
        <TextInput label="Имя" {...form.getInputProps('full_name')} />
        <Select
          label="Роль"
          data={options(ROLE_LABELS)}
          allowDeselect={false}
          {...form.getInputProps('role')}
        />
        {user && (
          <Switch label="Активен" {...form.getInputProps('is_active', { type: 'checkbox' })} />
        )}
        <PasswordInput
          label={user ? 'Новый пароль' : 'Пароль'}
          description={user ? 'Оставьте пустым, чтобы не менять' : undefined}
          required={!user}
          {...form.getInputProps('password')}
        />
        <FormButtons onCancel={onClose} loading={save.isPending} />
      </Stack>
    </form>
  )
}
