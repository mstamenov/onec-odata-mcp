import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildODataUrl, buildWriteUrl, isInsecureBaseUrl } from '../src/url.js'
import { normalizeFileConfig } from '../src/config.js'
import { defaultMetadataFetcher } from '../src/metadata/service.js'
import { parseMetadataXml } from '../src/metadata/parse-metadata.js'
import { buildODataQuery } from '../src/query/builder.js'
import {
  DEFAULT_QUERY_TOP,
  handleConfig,
  handleCount,
  handleQuery,
  handleWrite,
  isErrorPayload,
} from '../src/handlers.js'

const BASE = 'https://mock.test/db/odata/standard.odata'
const ROOT = 'https://mock.test/db/odata/standard.odata/'
const baseConfig = { baseUrl: BASE, username: 'u', password: 'p' }

/** Запускает run с конфигом из файла, чистым от ONEC_* окружением и перехваченным fetch. */
async function withMock(
  config: Record<string, unknown>,
  run: (calls: { url: string; init?: RequestInit }[]) => Promise<void>,
  respond: () => Response = () =>
    new Response(JSON.stringify({ value: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'onec-sec-'))
  const configPath = join(dir, 'onec-config.json')
  writeFileSync(configPath, JSON.stringify(config))

  const saved = new Map<string, string | undefined>()
  for (const name of Object.keys(process.env).filter((n) => n.startsWith('ONEC_'))) {
    saved.set(name, process.env[name])
    delete process.env[name]
  }
  process.env.ONEC_CONFIG_PATH = configPath

  const calls: { url: string; init?: RequestInit }[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return respond()
  }) as typeof fetch

  try {
    await run(calls)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.ONEC_CONFIG_PATH
    for (const [name, value] of saved) {
      if (value !== undefined) process.env[name] = value
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

test('buildODataUrl keeps the base path, with or without trailing slash', () => {
  for (const base of [BASE, `${BASE}/`]) {
    assert.equal(buildODataUrl(base, '').toString(), BASE)
    assert.equal(buildODataUrl(base, 'Catalog_X').toString(), `${ROOT}Catalog_X`)
    assert.equal(buildODataUrl(base, 'Catalog_X/$count').toString(), `${ROOT}Catalog_X/$count`)
    assert.equal(buildODataUrl(base, '$metadata').toString(), `${ROOT}$metadata`)
  }
  assert.equal(
    decodeURI(buildODataUrl(BASE, "AccumulationRegister_Остатки/Balance(Period=datetime'2024-01-01T00:00:00')").toString()),
    `${ROOT}AccumulationRegister_Остатки/Balance(Period=datetime'2024-01-01T00:00:00')`,
  )
})

test('buildODataUrl rejects paths that leave the host or the base path', () => {
  for (const bad of [
    '/evil.example/x',
    '//evil.example/x',
    'https://evil.example/x',
    '\\\\evil.example\\x',
    '../other_db/odata/standard.odata/Catalog_X',
    'Catalog_X/../../../other',
    '%2e%2e/%2e%2e/other',
    './Catalog_X',
    'Catalog_X?$format=json',
    'Catalog_X#frag',
    'Catalog_X\n',
    'Catalog_X/',
  ]) {
    assert.throws(() => buildODataUrl(BASE, bad), Error, bad)
  }
})

test('buildODataUrl rejects non-http base URLs', () => {
  assert.throws(() => buildODataUrl('file:///etc/passwd', 'x'))
  assert.throws(() => buildODataUrl('not a url', 'x'))
})

test('isInsecureBaseUrl flags plain http except on localhost', () => {
  assert.equal(isInsecureBaseUrl('http://1c.corp.test/db/odata/standard.odata'), true)
  assert.equal(isInsecureBaseUrl('http://localhost/db/odata/standard.odata'), false)
  assert.equal(isInsecureBaseUrl('http://127.0.0.1:8080/db/odata/standard.odata'), false)
  assert.equal(isInsecureBaseUrl(BASE), false)
})

test('buildWriteUrl allows only a plain entity name and a safe key', () => {
  assert.equal(
    decodeURI(buildWriteUrl(BASE, 'Catalog_Контрагенты', 'update', "guid'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'").toString()),
    `${ROOT}Catalog_Контрагенты(guid'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')`,
  )
  for (const entity of ["Document_X(guid'a')/Post", 'Catalog_X/Sub', '/evil.example/x', '../Catalog_X', '']) {
    assert.throws(() => buildWriteUrl(BASE, entity, 'create'), Error, entity)
  }
  for (const key of ["guid'a')/Post", '1)/../x(1', '1/2', '1?x=1', '']) {
    assert.throws(() => buildWriteUrl(BASE, 'Catalog_X', 'delete', key), Error, key)
  }
})

test('odata_query requests the entity under the base path with a default top', async () => {
  await withMock(baseConfig, async (calls) => {
    await handleQuery({ entity: 'Catalog_Контрагенты', filter: "Description eq 'x'" })
    assert.equal(calls.length, 1)
    const url = new URL(calls[0].url)
    assert.equal(url.origin, 'https://mock.test')
    assert.equal(decodeURI(url.pathname), '/db/odata/standard.odata/Catalog_Контрагенты')
    assert.equal(url.searchParams.get('$top'), String(DEFAULT_QUERY_TOP))
    assert.equal(url.searchParams.get('$filter'), "Description eq 'x'")

    await handleQuery({ entity: 'Catalog_Контрагенты', top: 5 })
    assert.equal(new URL(calls[1].url).searchParams.get('$top'), '5')

    const bad = JSON.parse(await handleQuery({ entity: 'Catalog_Контрагенты', top: 0 }))
    assert.ok(bad.error)
    assert.equal(calls.length, 2)
  })
})

test('odata_query and odata_count never send credentials to another host', async () => {
  await withMock(baseConfig, async (calls) => {
    for (const entity of ['/evil.example/x', '//evil.example/x', '../../other/odata/standard.odata/Catalog_X']) {
      for (const handler of [handleQuery, handleCount]) {
        const raw = await handler({ entity })
        assert.ok(isErrorPayload(raw), `${entity}: ${raw}`)
      }
    }
    assert.equal(calls.length, 0)
  })
})

test('odata_count requests $count under the base path and rejects non-numeric answers', async () => {
  await withMock(
    baseConfig,
    async (calls) => {
      const parsed = JSON.parse(await handleCount({ entity: 'Catalog_X' }))
      assert.equal(parsed.count, 42)
      assert.equal(calls[0].url, `${ROOT}Catalog_X/$count`)
    },
    () => new Response('42', { status: 200 }),
  )
  await withMock(
    baseConfig,
    async () => {
      assert.ok(isErrorPayload(await handleCount({ entity: 'Catalog_X' })))
    },
    () => new Response('<html>login</html>', { status: 200 }),
  )
})

test('default metadata fetcher requests $metadata under the base path', async () => {
  await withMock(
    baseConfig,
    async (calls) => {
      await defaultMetadataFetcher(baseConfig)
      assert.equal(calls[0].url, `${ROOT}$metadata`)
    },
    () => new Response('<edmx/>', { status: 200 }),
  )
})

test('odata_write sends the request to exactly the URL shown in the dry-run preview', async () => {
  await withMock({ ...baseConfig, writable: true }, async (calls) => {
    const args = {
      entity: 'Catalog_Контрагенты',
      method: 'update',
      key: "guid'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'",
      data: { Description: 'x' },
    }
    const preview = JSON.parse(await handleWrite(args))
    assert.equal(preview.dryRun, true)
    assert.equal(preview.writable, true)
    assert.equal(calls.length, 0)

    await handleWrite({ ...args, dryRun: false })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init?.method, 'PATCH')
    assert.equal(decodeURI(calls[0].url), preview.wouldExecute.url)
    assert.equal(
      preview.wouldExecute.url,
      `${ROOT}Catalog_Контрагенты(guid'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')`,
    )
  })
})

test('odata_write rejects action paths and unsafe keys even in dry-run', async () => {
  await withMock({ ...baseConfig, writable: true }, async (calls) => {
    const attempts = [
      { entity: "Document_X(guid'a')/Post", method: 'create', data: {} },
      { entity: '/evil.example/x', method: 'create', data: {} },
      { entity: 'Catalog_X', method: 'delete', key: "guid'a')/../../other(1" },
      { entity: 'Catalog_X', method: 'create', data: [1, 2] },
    ]
    for (const args of attempts) {
      for (const dryRun of [true, false]) {
        const raw = await handleWrite({ ...args, dryRun })
        assert.ok(isErrorPayload(raw), `${JSON.stringify(args)}: ${raw}`)
      }
    }
    assert.equal(calls.length, 0)
  })
})

test('writable is enabled only by boolean true in the config file', async () => {
  for (const value of ['false', 'true', 1, 'yes', {}, []]) {
    assert.equal(normalizeFileConfig({ ...baseConfig, writable: value })?.writable, undefined, String(value))
  }
  assert.equal(normalizeFileConfig({ ...baseConfig, writable: true })?.writable, true)
  assert.equal(normalizeFileConfig({ username: 'u' }), null)

  await withMock({ ...baseConfig, writable: 'false' }, async (calls) => {
    const raw = await handleWrite({ entity: 'Catalog_X', method: 'create', data: {}, dryRun: false })
    assert.match(JSON.parse(raw).error, /writable=false/)
    assert.equal(calls.length, 0)

    const preview = JSON.parse(await handleWrite({ entity: 'Catalog_X', method: 'create', data: {} }))
    assert.equal(preview.writable, false)
    assert.match(preview.note, /отключена/)
  })
})

test('odata_config reports writable status and warns about plain http', async () => {
  await withMock({ ...baseConfig, baseUrl: 'http://1c.corp.test/db/odata/standard.odata' }, async () => {
    const parsed = JSON.parse(await handleConfig({}))
    assert.equal(parsed.writable, false)
    assert.match(parsed.warning, /http/)
  })
  await withMock(baseConfig, async () => {
    assert.equal(JSON.parse(await handleConfig({})).warning, undefined)
  })
})

test('isErrorPayload recognises only top-level error objects', () => {
  assert.equal(isErrorPayload(JSON.stringify({ error: 'HTTP 500' })), true)
  assert.equal(isErrorPayload(JSON.stringify({ value: [{ error: 'поле данных' }] })), false)
  assert.equal(isErrorPayload(JSON.stringify([{ error: 'x' }])), false)
  assert.equal(isErrorPayload('not json'), false)
})

test('buildODataQuery rejects an injected sort direction and date', () => {
  const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'metadata.xml'), 'utf-8')
  const metadata = parseMetadataXml(fixture)
  assert.throws(
    () =>
      buildODataQuery(
        { entity: 'Catalog_Контрагенты', orderBy: [{ field: 'Description', direction: 'asc, Code desc' as 'asc' }] },
        metadata,
      ),
    /asc или desc/,
  )
  assert.throws(
    () =>
      buildODataQuery(
        {
          entity: 'Document_ПлатежноеПоручение',
          datePeriod: { field: 'Date', from: "datetime'2025-01-01T00:00:00' or 1 eq 1 or Date eq datetime'2025-01-01T00:00:00'" },
        },
        metadata,
      ),
    /Некорректный формат даты/,
  )
})
