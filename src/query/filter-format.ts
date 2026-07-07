import type { ODataProperty } from '../types.js'

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
    throw new Error(`Поле "${property.name}" ожидает boolean, получено: ${JSON.stringify(value)}`)
  }

  if (isNumberType(type)) {
    const num = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(num)) {
      throw new Error(`Поле "${property.name}" ожидает число, получено: ${JSON.stringify(value)}`)
    }
    return String(num)
  }

  if (isGuidType(type)) {
    const s = String(value).replace(/^guid'|'$/g, '')
    if (!GUID_RE.test(s)) {
      throw new Error(`Поле "${property.name}" ожидает GUID, получено: ${JSON.stringify(value)}`)
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
  if (value.startsWith("datetime'") && value.endsWith("'")) return value

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    value = `${value}T00:00:00`
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !value.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(value)) {
    // keep as-is for 1C local datetime
  } else if (!value.includes('T')) {
    throw new Error(`Некорректный формат даты: ${raw}. Используйте YYYY-MM-DD или ISO datetime.`)
  }

  return `datetime'${value}'`
}

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
      return `contains(${field},${literal})`
    case 'startswith':
      return `startswith(${field},${literal})`
    default:
      throw new Error(`Неподдерживаемый оператор: ${operator}`)
  }
}

export function joinFilters(parts: string[]): string | undefined {
  const valid = parts.filter(Boolean)
  if (valid.length === 0) return undefined
  return valid.map((p) => `(${p})`).join(' and ')
}

export function encodeODataQueryParams(params: Record<string, string | number | undefined>): string {
  const url = new URL('http://local.test/entity')
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url.search.slice(1)
}
