import { configMissingResponse, getConfig, getConfigPath } from './config.js'
import { CONFIG_SETUP_INSTRUCTIONS } from './types.js'
import { odataCount, odataRequest, odataWrite, type ODataWriteMethod } from './odata-client.js'
import { loadMetadata, getMetadataSummary, type MetadataFetcher } from './metadata/service.js'
import { explainEntity } from './metadata/parse-metadata.js'
import { buildODataQuery, parseBuildQueryArgs } from './query/builder.js'
import type { OneCConfig } from './types.js'

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
        note: '1С OData must be enabled in 1С configuration (Publish to web / OData standard)',
      },
      null,
      2,
    )
  }

  return JSON.stringify(
    {
      configured: true,
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      database: config.database ?? 'default',
      metadataCacheTtlMs: config.metadataCacheTtlMs ?? 3600000,
      note: 'Connection is configured. Try odata_list_entities or odata_explain_entity.',
    },
    null,
    2,
  )
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
  if (!entity) return JSON.stringify({ error: 'Missing required field: entity' })

  return odataRequest(`/${entity}`, config, {
    filter: args.filter ? String(args.filter) : undefined,
    select: args.select ? String(args.select) : undefined,
    top: args.top ? Number(args.top) : undefined,
    orderBy: args.orderBy ? String(args.orderBy) : undefined,
    expand: args.expand ? String(args.expand) : undefined,
  })
}

export async function handleCount(args: Record<string, unknown>): Promise<string> {
  const config = requireConfig()
  if (!config) return configMissingResponse()

  const entity = String(args.entity ?? '')
  if (!entity) return JSON.stringify({ error: 'Missing required field: entity' })

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
        note: 'Use odata_explain_entity for field details. Use odata_build_query to construct validated queries.',
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
  if (!entity) return JSON.stringify({ error: 'Missing required field: entity' })

  try {
    const fetcher = metadataFetcherOverride ?? undefined
    const metadata = await loadMetadata(config, fetcher)
    const explained = explainEntity(metadata, entity)
    if (!explained) {
      return JSON.stringify({
        error: `Сущность "${entity}" не найдена в metadata`,
        hint: 'Вызовите odata_metadata для списка сущностей',
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
  if (!input.entity) return JSON.stringify({ error: 'Missing required field: entity' })

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
  if (!entity) return JSON.stringify({ error: 'Missing required field: entity' })

  const method = String(args.method ?? '') as ODataWriteMethod
  if (method !== 'create' && method !== 'update' && method !== 'delete') {
    return JSON.stringify({
      error: 'Invalid method',
      hint: 'method must be one of: create, update, delete',
    })
  }

  if ((method === 'update' || method === 'delete') && (args.key === undefined || args.key === null || args.key === '')) {
    return JSON.stringify({ error: 'Missing required field: key (required for update/delete)' })
  }

  if ((method === 'create' || method === 'update') && (args.data === undefined || args.data === null)) {
    return JSON.stringify({ error: 'Missing required field: data (required for create/update)' })
  }

  const key = args.key !== undefined && args.key !== null ? String(args.key) : undefined
  const data =
    args.data !== undefined && args.data !== null && typeof args.data === 'object' && !Array.isArray(args.data)
      ? (args.data as Record<string, unknown>)
      : undefined

  // dryRun defaults to true — only explicit false enables real write path
  const dryRun = args.dryRun !== false

  if (dryRun) {
    const base = config.baseUrl.replace(/\/$/, '')
    let url: string
    if (method === 'create') {
      url = `${base}/${entity}`
    } else {
      url = `${base}/${entity}(${key})`
    }
    const wouldExecute: Record<string, unknown> = { method, entity, url }
    if (key !== undefined) wouldExecute.key = key
    if (method === 'create' || method === 'update') wouldExecute.body = data

    return JSON.stringify(
      {
        dryRun: true,
        wouldExecute,
        note: 'Запись НЕ выполнена (dry-run). Передайте dryRun:false, если действительно нужно записать.',
      },
      null,
      2,
    )
  }

  if (!config.writable) {
    return JSON.stringify(
      {
        error: 'Запись в эту базу отключена (writable=false)',
        entity,
        method,
        hint:
          'Включите запись явно: ONEC_WRITABLE=true в env, либо "writable": true в ~/.onec-odata/onec-config.json — только если это осознанное решение для этой базы.',
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
      results[entity] = { status: 'error parsing response' }
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
          ? `Found ${available.length} financial entities. Use odata_build_query or odata_query.`
          : 'No standard financial entities found. Run odata_metadata to see available entities.',
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
          description: 'Structured filters: field, operator (eq/ne/gt/ge/lt/le/contains/startswith), value',
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
      'Query 1С OData entity with filter, select, top, orderBy, expand. Example: entity="Catalog_Контрагенты" filter="Description eq \'ООО Ромашка\'"',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity name (e.g. Catalog_Контрагенты)' },
        filter: { type: 'string', description: 'OData $filter expression' },
        select: { type: 'string', description: 'Comma-separated fields ($select)' },
        top: { type: 'number', description: 'Max records ($top)' },
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
      'Auto-detect common 1С financial entities (счета, реализации, контрагенты, заявки) and show counts',
    inputSchema: { type: 'object', properties: {} },
  },
] as const
