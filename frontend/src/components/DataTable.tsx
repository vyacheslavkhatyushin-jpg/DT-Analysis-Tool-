import {
  Center,
  Group,
  Loader,
  ScrollArea,
  Table,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { IconChevronDown, IconChevronUp, IconSearch } from '@tabler/icons-react'
import { type ReactNode, useMemo, useState } from 'react'

export type Column<T> = {
  key: string
  header: string
  render?: (row: T) => ReactNode
  /** Value used for sorting and, as text, for the default cell and search. */
  value?: (row: T) => string | number | null | undefined
  align?: 'left' | 'right'
  width?: number | string
}

type Props<T> = {
  rows: T[] | undefined
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  loading?: boolean
  toolbar?: ReactNode
  actions?: (row: T) => ReactNode
  onRowClick?: (row: T) => void
  emptyText?: string
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  toolbar,
  actions,
  onRowClick,
  emptyText = 'Нет данных',
}: Props<T>) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null)

  const visible = useMemo(() => {
    let result = rows ?? []
    const needle = query.trim().toLowerCase()
    if (needle) {
      result = result.filter((row) =>
        columns.some((c) =>
          String(c.value?.(row) ?? '')
            .toLowerCase()
            .includes(needle),
        ),
      )
    }
    const column = sort && columns.find((c) => c.key === sort.key)
    if (sort && column?.value) {
      const get = column.value
      result = [...result].sort((a, b) => {
        const va = get(a)
        const vb = get(b)
        if (va === vb) return 0
        if (va === null || va === undefined) return 1
        if (vb === null || vb === undefined) return -1
        const order =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'ru', { numeric: true })
        return sort.desc ? -order : order
      })
    }
    return result
  }, [rows, columns, query, sort])

  const toggleSort = (key: string) =>
    setSort((current) =>
      current?.key === key ? (current.desc ? null : { key, desc: true }) : { key, desc: false },
    )

  return (
    <>
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <TextInput
          placeholder="Поиск"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          w={280}
        />
        <Group gap="xs">{toolbar}</Group>
      </Group>
      <ScrollArea>
        <Table striped highlightOnHover={Boolean(onRowClick)} verticalSpacing={6} fz="sm">
          <Table.Thead>
            <Table.Tr>
              {columns.map((column) => (
                <Table.Th key={column.key} w={column.width} ta={column.align}>
                  {column.value ? (
                    <UnstyledButton onClick={() => toggleSort(column.key)} fz="sm" fw={600}>
                      <Group
                        gap={2}
                        wrap="nowrap"
                        justify={column.align === 'right' ? 'flex-end' : undefined}
                      >
                        {column.header}
                        {sort?.key === column.key &&
                          (sort.desc ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />)}
                      </Group>
                    </UnstyledButton>
                  ) : (
                    column.header
                  )}
                </Table.Th>
              ))}
              {actions && <Table.Th w={1} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visible.map((row) => (
              <Table.Tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((column) => (
                  <Table.Td key={column.key} ta={column.align} style={{ whiteSpace: 'nowrap' }}>
                    {column.render ? column.render(row) : (column.value?.(row) ?? '—')}
                  </Table.Td>
                ))}
                {actions && (
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    <Group gap={4} wrap="nowrap">
                      {actions(row)}
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {loading && (
        <Center p="lg">
          <Loader size="sm" />
        </Center>
      )}
      {!loading && visible.length === 0 && (
        <Text c="dimmed" ta="center" p="lg">
          {emptyText}
        </Text>
      )}
      {!loading && rows && rows.length > 0 && (
        <Text size="xs" c="dimmed" mt="xs">
          Показано {visible.length} из {rows.length}
        </Text>
      )}
    </>
  )
}
