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

export type ODataWriteMethod = 'create' | 'update' | 'delete'

export type ODataWriteOptions = {
  key?: string
  data?: Record<string, unknown>
}

/**
 * Perform a write against 1C OData.
 * create → POST /entity, update → PATCH /entity(key), delete → DELETE /entity(key).
 * Caller is responsible for OData key quoting (guid'...', numbers, etc.).
 */
export async function odataWrite(
  entity: string,
  method: ODataWriteMethod,
  config: OneCConfig,
  options: ODataWriteOptions = {},
): Promise<string> {
  let path: string
  let httpMethod: string
  let body: string | undefined

  if (method === 'create') {
    path = `/${entity}`
    httpMethod = 'POST'
    body = JSON.stringify(options.data ?? {})
  } else if (method === 'update') {
    path = `/${entity}(${options.key})`
    httpMethod = 'PATCH'
    body = JSON.stringify(options.data ?? {})
  } else {
    path = `/${entity}(${options.key})`
    httpMethod = 'DELETE'
  }

  const url = new URL(path, config.baseUrl)
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

  try {
    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(url.toString(), {
      method: httpMethod,
      headers,
      body,
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const text = await res.text()
      return JSON.stringify({ error: `HTTP ${res.status}`, detail: text.slice(0, 500) })
    }

    if (method === 'delete') {
      return JSON.stringify({ status: res.status, entity }, null, 2)
    }

    const text = await res.text()
    if (!text) {
      return JSON.stringify({ status: res.status, entity }, null, 2)
    }
    try {
      const data = JSON.parse(text)
      return JSON.stringify(data, null, 2)
    } catch {
      return JSON.stringify({ status: res.status, entity, body: text.slice(0, 500) }, null, 2)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return JSON.stringify({ error: message, url: url.toString() })
  }
}
