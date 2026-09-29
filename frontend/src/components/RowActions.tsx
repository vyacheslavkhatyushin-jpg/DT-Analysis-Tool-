import { ActionIcon, Tooltip } from '@mantine/core'
import { IconMap, IconPencil, IconTrash } from '@tabler/icons-react'

export function EditAction({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip label="Изменить">
      <ActionIcon variant="subtle" size="sm" onClick={onClick} aria-label="Изменить">
        <IconPencil size={16} />
      </ActionIcon>
    </Tooltip>
  )
}

export function DeleteAction({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip label="Удалить">
      <ActionIcon variant="subtle" size="sm" color="red" onClick={onClick} aria-label="Удалить">
        <IconTrash size={16} />
      </ActionIcon>
    </Tooltip>
  )
}

export function MapAction({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip label="Показать на карте">
      <ActionIcon variant="subtle" size="sm" onClick={onClick} aria-label="Показать на карте">
        <IconMap size={16} />
      </ActionIcon>
    </Tooltip>
  )
}
