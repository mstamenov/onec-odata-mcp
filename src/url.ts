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
    throw new Error('Некорректный baseUrl: ожидается полный адрес вида https://host/db/odata/standard.odata')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Некорректный baseUrl: схема ${url.protocol} не поддерживается (нужен http или https)`)
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
    throw new Error(`Недопустимые символы в имени сущности: ${JSON.stringify(path)}`)
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`Недопустимый путь сущности: ${JSON.stringify(path)}`)
    }
  }
}

/** Имя сущности для записи: только идентификатор, без пути, скобок и вызовов действий. */
export function assertEntityName(entity: string): void {
  if (!ENTITY_NAME.test(entity)) {
    throw new Error(
      `Недопустимое имя сущности для записи: ${JSON.stringify(entity)}. Ожидается идентификатор вида Catalog_Контрагенты.`,
    )
  }
}

/** Ключ сущности, подставляемый в скобки: guid'...', число, 'строка' или составной Имя=значение,... */
export function assertEntityKey(key: string): void {
  if (key === '' || CONTROL_CHARS.test(key) || FORBIDDEN_IN_KEY.test(key)) {
    throw new Error(`Недопустимый ключ сущности: ${JSON.stringify(key)}`)
  }
}

export function buildODataUrl(baseUrl: string, resourcePath = ''): URL {
  const base = parseBaseUrl(baseUrl)
  assertResourcePath(resourcePath)

  const basePath = base.pathname.replace(/\/+$/, '')
  const url = new URL(`${base.origin}${basePath}${resourcePath ? `/${resourcePath}` : ''}`)

  const inside = url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)
  if (url.origin !== base.origin || !inside) {
    throw new Error(`Путь ${JSON.stringify(resourcePath)} выходит за пределы baseUrl`)
  }
  return url
}

export type WriteMethod = 'create' | 'update' | 'delete'

/** Адрес записи. Один и тот же для dry-run-превью и для реального запроса. */
export function buildWriteUrl(baseUrl: string, entity: string, method: WriteMethod, key?: string): URL {
  assertEntityName(entity)
  if (method === 'create') return buildODataUrl(baseUrl, entity)
  if (key === undefined) throw new Error('Не указан ключ сущности (нужен для update/delete)')
  assertEntityKey(key)
  return buildODataUrl(baseUrl, `${entity}(${key})`)
}
