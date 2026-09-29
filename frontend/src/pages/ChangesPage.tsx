import { Badge, SegmentedControl } from '@mantine/core'
import { useState } from 'react'

import { type Change, useChanges } from '../api/hooks'
import { ChangeDiff } from '../components/ChangeHistory'
import { type Column, DataTable } from '../components/DataTable'
import { ACTION_LABELS, ENTITY_LABELS, formatDateTime, plural, SOURCE_LABELS } from '../labels'
import { Page } from './PageLayout'

const columns: Column<Change>[] = [
  { key: 'ts', header: 'Время', value: (c) => c.ts, render: (c) => formatDateTime(c.ts) },
  { key: 'user', header: 'Кто', value: (c) => c.username ?? 'система' },
  { key: 'source', header: 'Источник', value: (c) => SOURCE_LABELS[c.source] },
  {
    key: 'entity',
    header: 'Объект',
    value: (c) => `${ENTITY_LABELS[c.entity_type] ?? c.entity_type} ${c.entity_label ?? ''}`,
  },
  {
    key: 'action',
    header: 'Действие',
    value: (c) => ACTION_LABELS[c.action],
    render: (c) => (
      <Badge variant="light" color={c.action === 'delete' ? 'red' : 'gray'}>
        {ACTION_LABELS[c.action]}
      </Badge>
    ),
  },
  {
    key: 'changes',
    header: 'Изменения',
    render: (c) =>
      c.action === 'update' ? (
        <ChangeDiff changes={c.changes} />
      ) : (
        plural(Object.keys(c.changes).length, 'поле', 'поля', 'полей')
      ),
  },
]

export function ChangesPage() {
  const [entity, setEntity] = useState('all')
  const changes = useChanges({ entity_type: entity === 'all' ? undefined : entity, limit: 500 })
  return (
    <Page
      title="Журнал изменений"
      description="Все изменения инвентаря: кто, когда и что поменял. Последние 500 записей."
    >
      <SegmentedControl
        w="fit-content"
        value={entity}
        onChange={setEntity}
        data={[
          { value: 'all', label: 'Все' },
          ...Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label })),
        ]}
      />
      <DataTable
        rows={changes.data}
        loading={changes.isPending}
        columns={columns}
        rowKey={(c) => c.id}
      />
    </Page>
  )
}
