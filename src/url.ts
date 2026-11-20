/**
 * Построение URL запросов к OData 1С.
 *
 * Всё, что уходит в сеть, собирается здесь: адрес обязан остаться на том же origin
 * и под путём baseUrl, иначе вместе с ним на чужой хост уедет заголовок Authorization.
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const FORBIDDEN_IN_PATH = /[\\?#%]/
const FORBIDDEN_IN_KEY = /[\\/?#%()]/
const ENTITY_NAME = /^[\p{L}\p{N}_]+$/u

export function parseBaseUrl(baseUrl: string): URL {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('Невалиден baseUrl: очаква се пълен адрес от вида https://host/db/odata/standard.odata')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Невалиден baseUrl: схемата ${url.protocol} не се поддържа (нужен е http или https)`)
  }
  return url
}

/** true, если baseUrl — нешифрованный http на не-локальном хосте (пароль пойдёт открытым текстом). */
export function isInsecureBaseUrl(baseUrl: string): boolean {
  const url = parseBaseUrl(baseUrl)
  if (url.protocol !== 'http:') return false
  const host = url.hostname
  return !(host === 'localhost' || host === '[::1]' || /^127\./.test(host))
}

/**
 * Путь ресурса относительно baseUrl: `Catalog_X`, `Catalog_X/$count`,
 * `AccumulationRegister_X/Balance(Period=datetime'...')`, `$metadata`. Пустая строка — сам сервис.
 */
export function assertResourcePath(path: string): void {
  if (path === '') return
  if (CONTROL_CHARS.test(path) || FORBIDDEN_IN_PATH.test(path)) {
    throw new Error(`Недопустими символи в името на обекта: ${JSON.stringify(path)}`)
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`Недопустим път на обекта: ${JSON.stringify(path)}`)
    }
  }
}

/** Имя сущности для записи: только идентификатор, без пути, скобок и вызовов действий. */
export function assertEntityName(entity: string): void {
  if (!ENTITY_NAME.test(entity)) {
    throw new Error(
      `Недопустимо име на обект за запис: ${JSON.stringify(entity)}. Очаква се идентификатор от вида Catalog_Контрагенты.`,
    )
  }
}

/** Ключ сущности, подставляемый в скобки: guid'...', число, 'строка' или составной Имя=значение,... */
export function assertEntityKey(key: string): void {
  if (key === '' || CONTROL_CHARS.test(key) || FORBIDDEN_IN_KEY.test(key)) {
    throw new Error(`Недопустим ключ на обекта: ${JSON.stringify(key)}`)
  }
}

export function buildODataUrl(baseUrl: string, resourcePath = ''): URL {
  const base = parseBaseUrl(baseUrl)
  assertResourcePath(resourcePath)

  const basePath = base.pathname.replace(/\/+$/, '')
  const url = new URL(`${base.origin}${basePath}${resourcePath ? `/${resourcePath}` : ''}`)

  const inside = url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)
  if (url.origin !== base.origin || !inside) {
    throw new Error(`Пътят ${JSON.stringify(resourcePath)} излиза извън baseUrl`)
  }
  return url
}

export type WriteMethod = 'create' | 'update' | 'delete'

/** Адрес записи. Один и тот же для dry-run-превью и для реального запроса. */
export function buildWriteUrl(baseUrl: string, entity: string, method: WriteMethod, key?: string): URL {
  assertEntityName(entity)
  if (method === 'create') return buildODataUrl(baseUrl, entity)
  if (key === undefined) throw new Error('Не е посочен ключ на обекта (нужен за update/delete)')
  assertEntityKey(key)
  return buildODataUrl(baseUrl, `${entity}(${key})`)
}

/**
 * Задаёт параметры запроса OData ($filter, $orderby, ...).
 *
 * URLSearchParams кодирует пробел как `+` (application/x-www-form-urlencoded), а 1С
 * `+` в пробел не превращает: `$filter=Number+eq+'1'` доходит до платформы обрезанным
 * до первого слова. Поэтому пробелы уходят как `%20`. Буквальный плюс URLSearchParams
 * уже записал как `%2B`, так что замена затрагивает только пробелы.
 *
 * После вызова нельзя трогать url.searchParams — он пересериализует строку с `+`.
 */
export function setODataQuery(url: URL, params: Record<string, string | number | undefined>): void {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  url.search = search.toString().replace(/\+/g, '%20')
}
