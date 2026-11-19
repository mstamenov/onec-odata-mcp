import type {
  BuildQueryInput,
  BuildQueryResult,
  DatePeriod,
  ODataEntityType,
  ODataMetadata,
  StructuredFilter,
} from '../types.js'
import { getEntityType, listResolvableEntityNames } from '../metadata/parse-metadata.js'
import { maybeYouMeant, fuzzySuggestions } from './fuzzy.js'
import { isSecretFieldName } from './fuzzy.js'
import {
  buildFilterComparison,
  encodeODataQueryParams,
  formatDateTimeLiteral,
  formatODataLiteral,
  isDateType,
  joinFilters,
} from './filter-format.js'

function findProperty(entity: ODataEntityType, fieldName: string) {
  return entity.properties.find((p) => p.name === fieldName)
}

function resolveField(entity: ODataEntityType, fieldName: string) {
  const prop = findProperty(entity, fieldName)
  if (prop) return { kind: 'property' as const, prop }
  const nav = entity.navigationProperties.find((n) => n.name === fieldName)
  if (nav) return { kind: 'navigation' as const, nav }
  return null
}

function validateFilters(
  entity: ODataEntityType,
  filters: StructuredFilter[] | undefined,
  warnings: string[],
): string[] {
  if (!filters?.length) return []
  const parts: string[] = []

  for (const f of filters) {
    const resolved = resolveField(entity, f.field)
    if (!resolved) {
      const fieldNames = entity.properties.map((p) => p.name)
      const hint = maybeYouMeant(f.field, fieldNames.filter((n) => !isSecretFieldName(n)))
      throw new Error(`Поле "${f.field}" не найдено в ${entity.name}.${hint ? ` ${hint}` : ''}`)
    }
    if (resolved.kind === 'navigation') {
      warnings.push(
        `Поле "${f.field}" — навигационное свойство; для фильтрации может потребоваться $expand.`,
      )
      continue
    }
    const literal = formatODataLiteral(f.value, resolved.prop)
    parts.push(buildFilterComparison(f.field, f.operator, literal))
  }

  return parts
}

function validateDatePeriod(
  entity: ODataEntityType,
  period: DatePeriod | undefined,
  warnings: string[],
): string[] {
  if (!period) return []
  const parts: string[] = []
  const resolved = resolveField(entity, period.field)
  if (!resolved || resolved.kind !== 'property') {
    const fieldNames = entity.properties.map((p) => p.name)
    const hint = maybeYouMeant(period.field, fieldNames.filter((n) => !isSecretFieldName(n)))
    throw new Error(`Поле периода "${period.field}" не найдено.${hint ? ` ${hint}` : ''}`)
  }
  if (!isDateType(resolved.prop.type)) {
    warnings.push(`Поле "${period.field}" имеет тип ${resolved.prop.type}, не дата — фильтр периода может не сработать.`)
  }
  if (period.from) {
    parts.push(`${period.field} ge ${formatDateTimeLiteral(period.from)}`)
  }
  if (period.to) {
    parts.push(`${period.field} le ${formatDateTimeLiteral(period.to)}`)
  }
  return parts
}

export function buildODataQuery(input: BuildQueryInput, metadata: ODataMetadata): BuildQueryResult {
  const warnings: string[] = []
  const entityNames = listResolvableEntityNames(metadata)

  let entityType = getEntityType(metadata, input.entity)
  if (!entityType) {
    const hint = maybeYouMeant(input.entity, entityNames)
    const suggestions = fuzzySuggestions(input.entity, entityNames)
    throw new Error(`Сущность "${input.entity}" не найдена в metadata.${hint ? ` ${hint}` : ''}`, {
      cause: { suggestions },
    })
  }

  const queryEntity = metadata.entitySets.has(input.entity) ? input.entity : entityType.name

  const filterParts = [
    ...validateFilters(entityType, input.filters, warnings),
    ...validateDatePeriod(entityType, input.datePeriod, warnings),
  ]
  const filter = joinFilters(filterParts)

  let orderBy: string | undefined
  if (input.orderBy?.length) {
    orderBy = input.orderBy
      .map((o) => {
        const resolved = resolveField(entityType!, o.field)
        if (!resolved) {
          const fieldNames = entityType!.properties.map((p) => p.name)
          const hint = maybeYouMeant(o.field, fieldNames.filter((n) => !isSecretFieldName(n)))
          throw new Error(`Поле сортировки "${o.field}" не найдено.${hint ? ` ${hint}` : ''}`)
        }
        if (resolved.kind === 'navigation') {
          warnings.push(`Сортировка по навигационному свойству "${o.field}" может не поддерживаться.`)
        }
        const direction = o.direction ?? 'asc'
        if (direction !== 'asc' && direction !== 'desc') {
          throw new Error(`Направление сортировки должно быть asc или desc, получено: ${JSON.stringify(direction)}`)
        }
        return `${o.field} ${direction}`
      })
      .join(', ')
  }

  let select: string | undefined
  if (input.select?.length) {
    for (const field of input.select) {
      if (!resolveField(entityType, field)) {
        const fieldNames = entityType.properties.map((p) => p.name)
        const hint = maybeYouMeant(field, fieldNames.filter((n) => !isSecretFieldName(n)))
        throw new Error(`Поле select "${field}" не найдено.${hint ? ` ${hint}` : ''}`)
      }
    }
    select = input.select.join(',')
  }

  let expand: string | undefined
  if (input.expand?.length) {
    for (const field of input.expand) {
      const nav = entityType.navigationProperties.find((n) => n.name === field)
      if (!nav) {
        const navNames = entityType.navigationProperties.map((n) => n.name)
        const hint = maybeYouMeant(field, navNames)
        throw new Error(`Navigation expand "${field}" не найден.${hint ? ` ${hint}` : ''}`)
      }
    }
    expand = input.expand.join(',')
  }

  const queryParams = {
    filter,
    select,
    top: input.top,
    orderBy,
    expand,
  }

  const encodedUrl = encodeODataQueryParams({
    $filter: filter,
    $select: select,
    $top: input.top,
    $orderby: orderBy,
    $expand: expand,
  })

  const explanationLines = [
    `Сущность: ${queryEntity}`,
    filter ? `Фильтр: ${filter}` : 'Фильтр: (нет)',
    select ? `Поля: ${select}` : 'Поля: (все)',
    input.top ? `Лимит: ${input.top}` : 'Лимит: (по умолчанию сервера)',
    orderBy ? `Сортировка: ${orderBy}` : 'Сортировка: (нет)',
    expand ? `Expand: ${expand}` : 'Expand: (нет)',
    encodedUrl ? `Query string (URL-encoded): ${encodedUrl}` : '',
  ].filter(Boolean)

  return {
    entity: queryEntity,
    queryParams,
    encodedUrl: encodedUrl || undefined,
    explanation: explanationLines.join('\n'),
    warnings,
  }
}

export function parseBuildQueryArgs(args: Record<string, unknown>): BuildQueryInput {
  return {
    entity: String(args.entity ?? ''),
    filters: Array.isArray(args.filters) ? (args.filters as StructuredFilter[]) : undefined,
    datePeriod: args.datePeriod as DatePeriod | undefined,
    top: args.top !== undefined ? Number(args.top) : undefined,
    orderBy: Array.isArray(args.orderBy) ? (args.orderBy as BuildQueryInput['orderBy']) : undefined,
    select: Array.isArray(args.select) ? (args.select as string[]) : undefined,
    expand: Array.isArray(args.expand) ? (args.expand as string[]) : undefined,
  }
}
