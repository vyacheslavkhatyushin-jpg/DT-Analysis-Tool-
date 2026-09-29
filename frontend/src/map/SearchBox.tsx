import { Combobox, Group, Loader, Text, TextInput, useCombobox } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconSearch } from '@tabler/icons-react'
import { useState } from 'react'

import { type SearchHit, useSearch } from '../api/hooks'

const TYPE_LABELS: Record<SearchHit['type'], string> = {
  site: 'сайт',
  cell: 'сота',
  device: 'устройство',
  asset: 'техника',
}

export function SearchBox({ onPick }: { onPick: (hit: SearchHit) => void }) {
  const combobox = useCombobox()
  const [value, setValue] = useState('')
  const [debounced] = useDebouncedValue(value, 250)
  const { data = [], isFetching } = useSearch(debounced)

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(key) => {
        const hit = data.find((h) => `${h.type}:${h.id}` === key)
        if (hit) onPick(hit)
        combobox.closeDropdown()
      }}
    >
      <Combobox.Target>
        <TextInput
          placeholder="Сайт, сота, ECI, PCI, устройство"
          leftSection={<IconSearch size={16} />}
          rightSection={isFetching ? <Loader size={14} /> : null}
          value={value}
          onChange={(e) => {
            setValue(e.currentTarget.value)
            combobox.openDropdown()
          }}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
        />
      </Combobox.Target>
      <Combobox.Dropdown hidden={!debounced.trim()}>
        <Combobox.Options mah={320} style={{ overflowY: 'auto' }}>
          {data.length === 0 && <Combobox.Empty>Ничего не найдено</Combobox.Empty>}
          {data.map((hit) => (
            <Combobox.Option key={`${hit.type}:${hit.id}`} value={`${hit.type}:${hit.id}`}>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <div>
                  <Text size="sm">{hit.label}</Text>
                  {hit.sublabel && (
                    <Text size="xs" c="dimmed">
                      {hit.sublabel}
                    </Text>
                  )}
                </div>
                <Text size="xs" c="dimmed">
                  {TYPE_LABELS[hit.type]}
                </Text>
              </Group>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}
