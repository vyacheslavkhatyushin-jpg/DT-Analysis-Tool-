import type { Schemas } from './api/client'

type Status = Schemas['SiteRead']['status']
type SiteKind = Schemas['SiteRead']['kind']
type DeviceKind = Schemas['DeviceRead']['kind']
type AssetKind = Schemas['AssetRead']['kind']
type Role = Schemas['UserRead']['role']

export const STATUS_LABELS: Record<Status, string> = {
  planned: 'планируется',
  active: 'в работе',
  inactive: 'отключен',
  dismantled: 'выведен',
}

export const SITE_KIND_LABELS: Record<SiteKind, string> = {
  stationary: 'стационарный',
  mobile: 'передвижной',
}

export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  phone: 'телефон',
  router: 'роутер',
  radio: 'рация',
  probe: 'зонд',
  other: 'другое',
}

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  haul_truck: 'самосвал',
  excavator: 'экскаватор',
  drill: 'буровой станок',
  dozer: 'бульдозер',
  loader: 'погрузчик',
  light_vehicle: 'автомобиль',
  other: 'другое',
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'администратор',
  engineer: 'инженер',
  viewer: 'просмотр',
}

export const ENTITY_LABELS: Record<string, string> = {
  site: 'Сайт',
  enodeb: 'eNodeB',
  cell: 'Сота',
  asset: 'Техника',
  device: 'Устройство',
  map_overlay: 'Слой карты',
}

export const ACTION_LABELS: Record<string, string> = {
  create: 'создание',
  update: 'изменение',
  delete: 'удаление',
}

export const SOURCE_LABELS: Record<string, string> = {
  ui: 'интерфейс',
  import: 'импорт',
  api: 'API',
  system: 'система',
}

export const FIELD_LABELS: Record<string, string> = {
  code: 'Код',
  name: 'Название',
  kind: 'Тип',
  status: 'Статус',
  lat: 'Широта',
  lon: 'Долгота',
  structure_type: 'Тип опоры',
  structure_height_m: 'Высота опоры, м',
  ground_elevation_m: 'Отметка земли, м',
  notes: 'Примечание',
  site_id: 'Сайт',
  enb_id: 'eNB ID',
  vendor: 'Производитель',
  hw_model: 'Оборудование',
  sw_version: 'Версия ПО',
  enodeb_id: 'eNodeB',
  local_cell_id: 'Cell ID',
  eci: 'ECI',
  pci: 'PCI',
  earfcn_dl: 'EARFCN DL',
  earfcn_ul: 'EARFCN UL',
  band: 'Диапазон',
  bandwidth_mhz: 'Полоса, МГц',
  tac: 'TAC',
  max_tx_power_dbm: 'Мощность, дБм',
  antenna_model: 'Модель антенны',
  height_m: 'Высота подвеса, м',
  azimuth_deg: 'Азимут, °',
  mech_tilt_deg: 'Мех. тилт, °',
  elec_tilt_deg: 'Эл. тилт, °',
  beamwidth_deg: 'Ширина ДН, °',
  imei: 'IMEI',
  imsi: 'IMSI',
  iccid: 'ICCID',
  model: 'Модель',
  asset_id: 'Техника',
  role: 'Роль',
  color: 'Цвет',
  visible_by_default: 'Показывать по умолчанию',
  features: 'Объектов',
}

export function options<T extends string>(labels: Record<T, string>) {
  return (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }))
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'string' && value in STATUS_LABELS) return STATUS_LABELS[value as Status]
  if (typeof value === 'string' && value in SITE_KIND_LABELS)
    return SITE_KIND_LABELS[value as SiteKind]
  if (typeof value === 'string' && value in DEVICE_KIND_LABELS)
    return DEVICE_KIND_LABELS[value as DeviceKind]
  if (typeof value === 'string' && value in ASSET_KIND_LABELS)
    return ASSET_KIND_LABELS[value as AssetKind]
  return String(value)
}

const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : '—'
}

const pluralRules = new Intl.PluralRules('ru-RU')

/** Russian plural form: plural(5, 'поле', 'поля', 'полей') → '5 полей'. */
export function plural(n: number, one: string, few: string, many: string): string {
  const form = pluralRules.select(n)
  return `${n} ${form === 'one' ? one : form === 'few' ? few : many}`
}
