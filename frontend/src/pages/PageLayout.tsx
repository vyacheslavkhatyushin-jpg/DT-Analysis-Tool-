import { Box, Group, Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Box p="lg" h="100%" style={{ overflow: 'auto' }}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={3}>{title}</Title>
            {description && (
              <Text size="sm" c="dimmed">
                {description}
              </Text>
            )}
          </div>
          <Group gap="xs">{actions}</Group>
        </Group>
        {children}
      </Stack>
    </Box>
  )
}
