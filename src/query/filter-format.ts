import type { ODataProperty } from '../types.js'
import { setODataQuery } from '../url.js'

const DATE_TYPES = new Set(['Edm.DateTime', 'Edm.DateTimeOffset', 'Edm.Date'])
const NUMBER_TYPES = new Set(['Edm.Int16', 'Edm.Int32', 'Edm.Int64', 'Edm.Decimal', 'Edm.Double', 'Edm.Single', 'Edm.Byte'])
const GUID_TYPES = new Set(['Edm.Guid'])
const BOOL_TYPES = new Set(['Edm.Boolean'])

export function normalizeODataType(type: string): string {
  if (type.startsWith('Edm.')) return type
  const short = type.includes('.') ? (type.split('.').pop() ?? type) : type
  return `Edm.${short}`
}

export function isDateType(type: string): boolean {
  return DATE_TYPES.has(normalizeODataType(type))
}

export function isNumberType(type: string): boolean {
  return NUMBER_TYPES.has(normalizeODataType(type))
}

export function isGuidType(type: string): boolean {
  return GUID_TYPES.has(normalizeODataType(type))
}

export function isBooleanType(type: string): boolean {
  return BOOL_TYPES.has(normalizeODataType(type))
}

export function isStringType(type: string): boolean {
  const t = normalizeODataType(type)
  return t === 'Edm.String' || (!isDateType(t) && !isNumberType(t) && !isGuidType(t) && !isBooleanType(t))
}

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function formatODataLiteral(value: string | number | boolean, property: ODataProperty): string {
  const type = normalizeODataType(property.type)

  if (isBooleanType(type)) {
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    const s = String(value).toLowerCase()
    if (s === 'true' || s === 'false') return s
    throw new Error(`Полето "${property.name}" очаква boolean, получено: ${JSON.stringify(value)}`)
  }

  if (isNumberType(type)) {
    const num = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(num)) {
      throw new Error(`Полето "${property.name}" очаква число, получено: ${JSON.stringify(value)}`)
    }
    return String(num)
  }

  if (isGuidType(type)) {
    const s = String(value).replace(/^guid'|'$/g, '')
    if (!GUID_RE.test(s)) {
      throw new Error(`Полето "${property.name}" очаква GUID, получено: ${JSON.stringify(value)}`)
    }
    return `guid'${s.toLowerCase()}'`
  }

  if (isDateType(type)) {
    return formatDateTimeLiteral(String(value))
  }

  return `'${escapeODataString(String(value))}'`
}

export function formatDateTimeLiteral(raw: string): string {
  let value = raw.trim()
  const wrapped = /^datetime'(.*)'$/.exec(value)
  if (wrapped) value = wrapped[1]

  // Литерал попадает в $filter как есть, поэтому допускаем только строгую форму даты.
  if (!DATETIME_RE.test(value)) {
    throw new Error(
      `Невалиден формат на дата: ${JSON.stringify(raw)}. Използвайте YYYY-MM-DD или YYYY-MM-DDTHH:MM:SS.`,
    )
  }
  if (!value.includes('T')) value = `${value}T00:00:00`

  return `datetime'${value}'`
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})?)?$/

export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

export function buildFilterComparison(
  field: string,
  operator: string,
  literal: string,
): string {
  switch (operator) {
    case 'eq':
    case 'ne':
    case 'gt':
    case 'ge':
    case 'lt':
    case 'le':
      return `${field} ${operator} ${literal}`
    case 'contains':
      // 1С реализует OData v3: поиск подстроки — substringof(что, где), а не contains() из v4.
      return `substringof(${literal},${field}) eq true`
    case 'startswith':
      return `startswith(${field},${literal})`
    default:
      throw new Error(`Неподдържан оператор: ${operator}`)
  }
}

export function joinFilters(parts: string[]): string | undefined {
  const valid = parts.filter(Boolean)
  if (valid.length === 0) return undefined
  return valid.map((p) => `(${p})`).join(' and ')
}

export function encodeODataQueryParams(params: Record<string, string | number | undefined>): string {
  const url = new URL('http://local.test/entity')
  setODataQuery(url, params)
  return url.search.slice(1)
}
