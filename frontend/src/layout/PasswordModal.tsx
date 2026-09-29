import { Modal, PasswordInput, Stack } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMutation } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { notifySaved } from '../components/confirm'
import { FormButtons } from '../forms/common'
import { handleSubmitError } from '../forms/values'

type Values = { current_password: string; new_password: string; repeat: string }

export function PasswordModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const form = useForm<Values>({
    initialValues: { current_password: '', new_password: '', repeat: '' },
    validate: {
      new_password: (v) => (v.length >= 8 ? null : 'Не короче 8 символов'),
      repeat: (v, values) => (v === values.new_password ? null : 'Пароли не совпадают'),
    },
  })
  const save = useMutation({
    mutationFn: (values: Values) =>
      unwrap(
        api.POST('/api/v1/auth/password', {
          body: { current_password: values.current_password, new_password: values.new_password },
        }),
      ),
  })
  const close = () => {
    form.reset()
    onClose()
  }
  return (
    <Modal opened={opened} onClose={close} title="Смена пароля">
      <form
        onSubmit={form.onSubmit((values) =>
          save.mutate(values, {
            onSuccess: () => {
              notifySaved('Пароль изменён')
              close()
            },
            onError: (error) => handleSubmitError(form, error, ['current_password']),
          }),
        )}
      >
        <Stack>
          <PasswordInput
            label="Текущий пароль"
            required
            {...form.getInputProps('current_password')}
          />
          <PasswordInput label="Новый пароль" required {...form.getInputProps('new_password')} />
          <PasswordInput label="Повторите пароль" required {...form.getInputProps('repeat')} />
          <FormButtons onCancel={close} loading={save.isPending} />
        </Stack>
      </form>
    </Modal>
  )
}
