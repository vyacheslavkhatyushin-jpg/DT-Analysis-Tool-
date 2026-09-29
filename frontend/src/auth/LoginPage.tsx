import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconAntennaBars5 } from '@tabler/icons-react'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'

import { useAuth } from './context'

export function LoginPage() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const form = useForm({ initialValues: { username: '', password: '' } })

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  const submit = form.onSubmit(async ({ username, password }) => {
    setSubmitting(true)
    setError(null)
    try {
      await login(username.trim(), password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти')
    } finally {
      setSubmitting(false)
    }
  })

  return (
    <Center h="100vh" bg="var(--mantine-color-gray-0)">
      <Paper withBorder shadow="sm" p="xl" radius="md" w={360}>
        <form onSubmit={submit}>
          <Stack>
            <Stack gap={4} align="center">
              <IconAntennaBars5 size={36} stroke={1.5} />
              <Title order={3}>DT Analysis Tool</Title>
              <Text size="sm" c="dimmed">
                Частная LTE-сеть карьера
              </Text>
            </Stack>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput
              label="Пользователь"
              autoComplete="username"
              required
              {...form.getInputProps('username')}
            />
            <PasswordInput
              label="Пароль"
              autoComplete="current-password"
              required
              {...form.getInputProps('password')}
            />
            <Button type="submit" loading={submitting}>
              Войти
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
