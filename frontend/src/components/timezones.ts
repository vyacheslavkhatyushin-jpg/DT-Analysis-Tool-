/** The browser's time zone: reports and logs are usually in the local time of the network. */
export const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

export function zoneOptions(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [...new Set([BROWSER_ZONE, 'Asia/Almaty', 'UTC', ...zones])]
}
