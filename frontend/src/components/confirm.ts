import { notifications } from '@mantine/notifications'

export function notifyError(error: unknown) {
  notifications.show({
    color: 'red',
    title: 'Ошибка',
    message: error instanceof Error ? error.message : String(error),
  })
}

export function notifySaved(message = 'Сохранено') {
  notifications.show({ color: 'green', message })
}

export function confirmDelete(what: string): boolean {
  return window.confirm(`Удалить ${what}? Действие попадёт в журнал изменений.`)
}
