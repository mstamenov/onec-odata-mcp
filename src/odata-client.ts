import type { OneCConfig } from './types.js'
import { buildODataUrl, buildWriteUrl, setODataQuery, type WriteMethod } from './url.js'

export type ODataRequestOptions = {
  filter?: string
  select?: string
  top?: number
  orderBy?: string
  expand?: string
}

function basicAuth(config: OneCConfig): string {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
}

function errorJson(err: unknown): string {
  return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
}

/** GET resource path relative to the service root ('' = entity list). */
export async function odataRequest(
  path: string,
  config: OneCConfig,
  options?: ODataRequestOptions,
): Promise<string> {
  try {
    const url = buildODataUrl(config.baseUrl, path)

    setODataQuery(url, {
      $filter: options?.filter,
      $select: options?.select,
      $top: options?.top,
      $orderby: options?.orderBy,
      $expand: options?.expand,
    })

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: basicAuth(config),
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
    return errorJson(err)
  }
}

export async function odataCount(
  entity: string,
  config: OneCConfig,
  filter?: string,
): Promise<string> {
  try {
    const url = buildODataUrl(config.baseUrl, `${entity}/$count`)
    setODataQuery(url, { $filter: filter })

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: basicAuth(config),
        // 1С отвечает 406 на Accept: text/plain; с application/json отдаёт число как есть.
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}` })
    }

    const text = (await res.text()).trim()
    const count = Number(text)
    if (text === '' || !Number.isFinite(count)) {
      return JSON.stringify({ error: 'Сървърът върна нечислов отговор на $count', detail: text.slice(0, 200) })
    }
    return JSON.stringify({ entity, count })
  } catch (err: unknown) {
    return errorJson(err)
  }
}

export type ODataWriteMethod = WriteMethod

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
  try {
    const url = buildWriteUrl(config.baseUrl, entity, method, options.key)
    const httpMethod = method === 'create' ? 'POST' : method === 'update' ? 'PATCH' : 'DELETE'
    const body = method === 'delete' ? undefined : JSON.stringify(options.data ?? {})

    const headers: Record<string, string> = {
      Authorization: basicAuth(config),
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
    return errorJson(err)
  }
}
