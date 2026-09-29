import { Button, Group } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'

import { useState } from 'react'

export function EffectiveAtInput(props: {
  value: string | null
  onChange: (value: string | null) => void
  description?: string
}) {
  const [now] = useState(() => new Date())
  return (
    <DateTimePicker
      label="Дата изменения в сети"
      description={
        props.description ??
        'Если изменение произошло раньше, укажите когда: история параметров сохранится точно'
      }
      placeholder="сейчас"
      clearable
      maxDate={now}
      valueFormat="DD.MM.YYYY HH:mm"
      value={props.value}
      onChange={props.onChange}
    />
  )
}

export function FormButtons({ onCancel, loading }: { onCancel: () => void; loading: boolean }) {
  return (
    <Group justify="flex-end" mt="md">
      <Button variant="default" onClick={onCancel}>
        Отмена
      </Button>
      <Button type="submit" loading={loading}>
        Сохранить
      </Button>
    </Group>
  )
}
