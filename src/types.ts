export type OneCConfig = {
  baseUrl: string
  username: string
  password: string
  database?: string
  metadataCacheTtlMs?: number
}

export type ODataProperty = {
  name: string
  type: string
  nullable?: boolean
}

export type ODataNavigationProperty = {
  name: string
  type: string
  partner?: string
}

export type ODataEntityType = {
  name: string
  keys: string[]
  properties: ODataProperty[]
  navigationProperties: ODataNavigationProperty[]
}

export type ODataMetadata = {
  entityTypes: Map<string, ODataEntityType>
  entitySets: Map<string, string>
  fetchedAt?: number
  cacheKey?: string
}

export type FilterOperator = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'contains' | 'startswith'

export type StructuredFilter = {
  field: string
  operator: FilterOperator
  value: string | number | boolean
}

export type DatePeriod = {
  field: string
  from?: string
  to?: string
}

export type OrderByClause = {
  field: string
  direction?: 'asc' | 'desc'
}

export type BuildQueryInput = {
  entity: string
  filters?: StructuredFilter[]
  datePeriod?: DatePeriod
  top?: number
  orderBy?: OrderByClause[]
  select?: string[]
  expand?: string[]
}

export type BuildQueryResult = {
  entity: string
  queryParams: {
    filter?: string
    select?: string
    top?: number
    orderBy?: string
    expand?: string
  }
  encodedUrl?: string
  explanation: string
  warnings: string[]
  suggestions?: string[]
}

export const CONFIG_PATH_SUFFIX = '.onec-odata/onec-config.json'

export const DEFAULT_METADATA_CACHE_TTL_MS = 60 * 60 * 1000

export const CONFIG_SETUP_INSTRUCTIONS = {
  ru: 'Настройте подключение к OData 1С через переменные окружения или файл конфигурации.',
  en: 'Configure the 1C OData connection via environment variables or a config file.',
  steps: [
    '1. Убедитесь, что в 1С опубликован OData (standard.odata).',
    '2a. Рекомендуется — задайте env-переменные: ONEC_BASE_URL, ONEC_USERNAME, ONEC_PASSWORD (опционально ONEC_DATABASE, ONEC_METADATA_CACHE_TTL_MS).',
    '2b. Либо создайте файл ~/.onec-odata/onec-config.json с полями baseUrl, username, password.',
    '3. Проверьте: вызовите odata_config или odata_list_entities.',
  ],
  example: {
    baseUrl: 'https://1c.example.com/your_db/odata/standard.odata',
    username: 'odata_user',
    password: 'odata_password',
    database: 'your_db',
    metadataCacheTtlMs: 3600000,
  },
}
