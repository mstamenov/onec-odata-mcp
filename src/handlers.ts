import { configMissingResponse, getConfig, getConfigPath } from './config.js'
import { CONFIG_SETUP_INSTRUCTIONS } from './types.js'
import { odataCount, odataRequest, odataWrite, type ODataWriteMethod } from './odata-client.js'
import { loadMetadata, getMetadataSummary, type MetadataFetcher } from './metadata/service.js'
import { explainEntity } from './metadata/parse-metadata.js'
import { buildODataQuery, parseBuildQueryArgs } from './query/builder.js'
import type { OneCConfig } from './types.js'
import { assertEntityKey, assertEntityName, buildWriteUrl, isInsecureBaseUrl, parseBaseUrl } from './url.js'

/** Лимит записей для odata_query, если top не передан: без него 1С вернёт всю таблицу. */
export const DEFAULT_QUERY_TOP = 100

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** true, если ответ инструмента — JSON-объект с полем error на верхнем уровне. */
export function isErrorPayload(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'error' in parsed
  } catch {
    return false
  }
}

let metadataFetcherOverride: MetadataFetcher | null = null

export function setMetadataFetcher(fetcher: MetadataFetcher | null): void {
  metadataFetcherOverride = fetcher
}

function requireConfig(): OneCConfig | null {
  return getConfig()
}

export async function handleConfig(_args: Record<string, unknown>): Promise<string> {
  const config = getConfig()
  if (!config) {
    return JSON.stringify(
      {
        configured: false,
        configPath: getConfigPath(),
        setup: CONFIG_SETUP_INSTRUCTIONS.example,
        instructions: CONFIG_SETUP_INSTRUCTIONS,
        note: 'OData трябва да е публикуван в конфигурацията на 1С (уеб публикация / стандартен OData интерфейс)',
      },
      null,
      2,
    )
  }

  try {
    parseBaseUrl(config.baseUrl)
  } catch (err: unknown) {
    return JSON.stringify({ configured: false, error: errorMessage(err) }, null, 2)
  }

  const status: Record<string, unknown> = {
    configured: true,
    baseUrl: config.baseUrl.replace(/\/$/, ''),
    database: config.database ?? 'default',
    metadataCacheTtlMs: config.metadataCacheTtlMs ?? 3600000,
    writable: config.writable === true,
    note: 'Връзката е конфигурирана. Опитайте odata_list_entities или odata_explain_entity.',
  }
  if (isInsecureBaseUrl(config.baseUrl)) {
    status.warning =
      'baseUrl използва http без криптиране: потребителското име и паролата се предават в явен вид. Използвайте https.'
  }

  return JSON.stringify(status, null, 2)
}

export async function handleListEntities(_args: Record<string, unknown>): Promise<string> {
  const config = requireConfig()
  if (!config) return configMissingResponse()
  return odataRequest('', config)
}

export async function handleQuery(args: Record<string, unknown>): Promise<string> {
  const config = requireConfig()
  if (!config) return configMissingResponse()

  const entity = String(args.entity ?? '')
  if (!entity) return JSON.stringify({ error: 'Липсва задължително поле: entity' })

  let top = DEFAULT_QUERY_TOP
  if (args.top !== undefined && args.top !== null) {
    top = Number(args.top)
    if (!Number.isInteger(top) || top < 1) {
      return JSON.stringify({ error: 'top трябва да е цяло число ≥ 1' })
    }
  }

  return odataRequest(entity, config, {
    filter: args.filter ? String(args.filter) : undefined,
    select: args.select ? String(args.select) : undefined,
    top,
    orderBy: args.orderBy ? String(args.orderBy) : undefined,
    expand: args.expand ? String(args.expand) : undefined,
  })
}

export async function handleCount(args: Record<string, unknown>): Promise<string> {
  const config = requireConfig()
  if (!config) return configMissingResponse()

  const entity = String(args.entity ?? '')
  if (!entity) return JSON.stringify({ error: 'Липсва задължително поле: entity' })

  return odataCount(entity, config, args.filter ? String(args.filter) : undefined)
}

export async function handleMetadata(args: Record<string, unknown>): Promise<string> {
  const config = requireConfig()
  if (!config) return configMissingResponse()

  try {
    const fetcher = metadataFetcherOverride ?? undefined
    const forceRefresh = Boolean(args.refresh)
    if (forceRefresh) {
      const { loadMetadata } = await import('./metadata/service.js')
      await loadMetadata(config, fetcher, true)
    }
    const summary = await getMetadataSummary(config, fetcher)
    return JSON.stringify(
      {
        ...summary,
        note: 'Използвайте odata_explain_entity за подробности за полетата и odata_build_query за съставяне на валидирани заявки.',
      },
      null,
      2,
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return JSON.stringify({ error: message })
  }
}

export async function handleExplainEntity(args: Record<string, unknown>): Promise<string> {
  const config = requireConfig()
  if (!config) return configMissingResponse()

  const entity = String(args.entity ?? '')
  if (!entity) return JSON.stringify({ error: 'Липсва задължително поле: entity' })

  try {
    const fetcher = metadataFetcherOverride ?? undefined
    const metadata = await loadMetadata(config, fetcher)
    const explained = explainEntity(metadata, entity)
    if (!explained) {
      return JSON.stringify({
        error: `Обектът "${entity}" не е намерен в метаданните`,
        hint: 'Извикайте odata_metadata за списък на обектите',
      })
    }
    return JSON.stringify(explained, null, 2)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return JSON.stringify({ error: message })
  }
}

export async function handleBuildQuery(args: Record<string, unknown>): Promise<string> {
  const config = requireConfig()
  if (!config) return configMissingResponse()

  const input = parseBuildQueryArgs(args)
  if (!input.entity) return JSON.stringify({ error: 'Липсва задължително поле: entity' })

  try {
    const fetcher = metadataFetcherOverride ?? undefined
    const metadata = await loadMetadata(config, fetcher)
    const result = buildODataQuery(input, metadata)
    return JSON.stringify(
      {
        ...result,
        readyForOdataQuery: {
          entity: result.entity,
          ...result.queryParams,
        },
      },
      null,
      2,
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const cause = err instanceof Error && 'cause' in err ? (err.cause as { suggestions?: string[] }) : undefined
    return JSON.stringify({
      error: message,
      suggestions: cause?.suggestions,
    })
  }
}

export async function handleWrite(args: Record<string, unknown>): Promise<string> {
  const config = requireConfig()
  if (!config) return configMissingResponse()

  const entity = String(args.entity ?? '')
  if (!entity) return JSON.stringify({ error: 'Липсва задължително поле: entity' })

  const method = String(args.method ?? '') as ODataWriteMethod
  if (method !== 'create' && method !== 'update' && method !== 'delete') {
    return JSON.stringify({
      error: 'Невалиден метод',
      hint: 'method трябва да е едно от: create, update, delete',
    })
  }

  if ((method === 'update' || method === 'delete') && (args.key === undefined || args.key === null || args.key === '')) {
    return JSON.stringify({ error: 'Липсва задължително поле: key (нужно за update/delete)' })
  }

  if ((method === 'create' || method === 'update') && (args.data === undefined || args.data === null)) {
    return JSON.stringify({ error: 'Липсва задължително поле: data (нужно за create/update)' })
  }

  const key = args.key !== undefined && args.key !== null ? String(args.key) : undefined
  const data =
    args.data !== undefined && args.data !== null && typeof args.data === 'object' && !Array.isArray(args.data)
      ? (args.data as Record<string, unknown>)
      : undefined

  if ((method === 'create' || method === 'update') && data === undefined) {
    return JSON.stringify({ error: 'Полето data трябва да е JSON обект' })
  }

  // Валидация до dry-run: превью обязано показывать ровно тот адрес, куда уйдёт запись.
  let url: string
  try {
    assertEntityName(entity)
    if (key !== undefined) assertEntityKey(key)
    url = decodeURI(buildWriteUrl(config.baseUrl, entity, method, key).toString())
  } catch (err: unknown) {
    return JSON.stringify({ error: errorMessage(err) })
  }

  // dryRun defaults to true — only explicit false enables real write path
  const dryRun = args.dryRun !== false

  if (dryRun) {
    const wouldExecute: Record<string, unknown> = { method, entity, url }
    if (key !== undefined) wouldExecute.key = key
    if (method === 'create' || method === 'update') wouldExecute.body = data

    return JSON.stringify(
      {
        dryRun: true,
        writable: config.writable === true,
        wouldExecute,
        note:
          config.writable === true
            ? 'Записът НЕ е изпълнен (dry-run). Подайте dryRun:false, ако наистина трябва да се запише.'
            : 'Записът НЕ е изпълнен (dry-run). Записът в тази база е изключен (writable=false): dryRun:false ще върне грешка.',
      },
      null,
      2,
    )
  }

  if (!config.writable) {
    return JSON.stringify(
      {
        error: 'Записът в тази база е изключен (writable=false)',
        entity,
        method,
        hint:
          'Включете записа изрично: ONEC_WRITABLE=true в средата или "writable": true в ~/.onec-odata/onec-config.json — само ако това е съзнателно решение за тази база.',
      },
      null,
      2,
    )
  }

  return odataWrite(entity, method, config, { key, data })
}

export async function handleFinancialSummary(_args: Record<string, unknown>): Promise<string> {
  const config = requireConfig()
  if (!config) return configMissingResponse()

  const commonEntities = [
    'Document_СчетНаОплатуПокупателю',
    'Document_РеализацияТоваровУслуг',
    'Document_ПоступлениеТоваровУслуг',
    'Document_СчетФактура',
    'Document_SalesOrder',
    'Document_ПлатежноеПоручение',
    'Catalog_Контрагенты',
    'Catalog_Номенклатура',
    'Catalog_ДоговорыКонтрагентов',
  ]

  const results: Record<string, { status: string; count?: number }> = {}

  for (const entity of commonEntities) {
    const raw = await odataCount(entity, config)
    try {
      const parsed = JSON.parse(raw) as { error?: string; count?: number }
      if (parsed.error) {
        results[entity] = { status: parsed.error }
      } else {
        results[entity] = { status: 'available', count: parsed.count }
      }
    } catch {
      results[entity] = { status: 'грешка при разчитане на отговора' }
    }
  }

  const available = Object.entries(results).filter(([, v]) => v.status === 'available')

  return JSON.stringify(
    {
      config: config.baseUrl,
      available: available.length,
      entities: results,
      recommendation:
        available.length > 0
          ? `Намерени финансови обекти: ${available.length}. Използвайте odata_build_query или odata_query.`
          : 'Не са намерени стандартни финансови обекти. Извикайте odata_metadata, за да видите наличните.',
    },
    null,
    2,
  )
}

export const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<string> | string> = {
  odata_config: handleConfig,
  odata_list_entities: handleListEntities,
  odata_metadata: handleMetadata,
  odata_explain_entity: handleExplainEntity,
  odata_build_query: handleBuildQuery,
  odata_query: handleQuery,
  odata_count: handleCount,
  odata_write: handleWrite,
  odata_financial_summary: handleFinancialSummary,
}

export const toolDefinitions = [
  {
    name: 'odata_config',
    description: 'Check 1С OData configuration status and setup instructions',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'odata_list_entities',
    description: 'List all available OData entities from 1С',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'odata_metadata',
    description: 'Get entity types and entity sets from 1С metadata (cached, TTL default 1h)',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: 'Force refresh metadata cache' },
      },
    },
  },
  {
    name: 'odata_explain_entity',
    description: 'Describe entity fields, types, keys and navigation properties from metadata',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity name (e.g. Catalog_Контрагенты)' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'odata_build_query',
    description:
      'Build validated OData query parameters from structured intent (filters, date period, sort, top). Returns params for odata_query + human explanation.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Target entity name' },
        filters: {
          type: 'array',
          description: 'Structured filters: field, operator (eq/ne/gt/ge/lt/le/contains/startswith), value. contains is emitted as OData v3 substringof().',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operator: { type: 'string' },
              value: {},
            },
            required: ['field', 'operator', 'value'],
          },
        },
        datePeriod: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            from: { type: 'string', description: 'YYYY-MM-DD or ISO datetime' },
            to: { type: 'string' },
          },
          required: ['field'],
        },
        top: { type: 'number' },
        orderBy: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'] },
            },
            required: ['field'],
          },
        },
        select: { type: 'array', items: { type: 'string' } },
        expand: { type: 'array', items: { type: 'string' } },
      },
      required: ['entity'],
    },
  },
  {
    name: 'odata_query',
    description:
      `Query 1С OData entity with filter, select, top, orderBy, expand. Returns at most ${DEFAULT_QUERY_TOP} records unless top is given. ` +
      'Example: entity="Catalog_Контрагенты" filter="Description eq \'ООО Ромашка\'"',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity name (e.g. Catalog_Контрагенты)' },
        filter: { type: 'string', description: 'OData $filter expression' },
        select: { type: 'string', description: 'Comma-separated fields ($select)' },
        top: {
          type: 'number',
          description: `Max records ($top). Defaults to ${DEFAULT_QUERY_TOP} when omitted — pass a larger value explicitly if you need more.`,
        },
        orderBy: { type: 'string', description: 'Sort field ($orderby)' },
        expand: { type: 'string', description: 'Navigation properties ($expand)' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'odata_count',
    description: 'Count records in an OData entity, optionally with filter',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity name' },
        filter: { type: 'string', description: 'OData $filter expression' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'odata_write',
    description:
      'Create/update/delete an OData entity. Default dryRun=true (preview only). Real write requires writable:true on the base config AND dryRun:false.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity name (e.g. Catalog_Контрагенты)' },
        method: {
          type: 'string',
          enum: ['create', 'update', 'delete'],
          description: 'Write operation: create (POST), update (PATCH), delete (DELETE)',
        },
        key: {
          type: 'string',
          description:
            'OData entity key for update/delete, as-is (e.g. guid\'...\', numeric id). Caller formats key quoting.',
        },
        data: {
          type: 'object',
          description: 'JSON body for create/update',
        },
        dryRun: {
          type: 'boolean',
          description:
            'If true (default), return wouldExecute preview without network call. Pass false only when ready to write.',
        },
      },
      required: ['entity', 'method'],
    },
  },
  {
    name: 'odata_financial_summary',
    description:
      'Auto-detect common 1С financial entities (invoices, sales, purchases, counterparties, orders) and show counts',
    inputSchema: { type: 'object', properties: {} },
  },
] as const
