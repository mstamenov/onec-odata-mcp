import type { OneCConfig } from './types.js'

export type ODataRequestOptions = {
  filter?: string
  select?: string
  top?: number
  orderBy?: string
  expand?: string
}

export async function odataRequest(
  path: string,
  config: OneCConfig,
  options?: ODataRequestOptions,
): Promise<string> {
  const url = new URL(path, config.baseUrl)

  if (options?.filter) url.searchParams.set('$filter', options.filter)
  if (options?.select) url.searchParams.set('$select', options.select)
  if (options?.top) url.searchParams.set('$top', String(options.top))
  if (options?.orderBy) url.searchParams.set('$orderby', options.orderBy)
  if (options?.expand) url.searchParams.set('$expand', options.expand)

  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const text = await res.text()
      return JSON.stringify({ error: `HTTP ${res.status}`, detail: text.slice(0, 500) })
    }

    const data = await res.json()
    return JSON.stringify(data, null, 2)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return JSON.stringify({ error: message, url: url.toString() })
  }
}

export async function odataCount(
  entity: string,
  config: OneCConfig,
  filter?: string,
): Promise<string> {
  const url = new URL(`/${entity}/$count`, config.baseUrl)
  if (filter) url.searchParams.set('$filter', filter)

  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'text/plain',
      },
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}` })
    }

    const count = await res.text()
    return JSON.stringify({ entity, count: Number(count) })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return JSON.stringify({ error: message })
  }
}
