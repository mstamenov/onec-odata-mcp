import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  handleConfig,
  handleListEntities,
  handleMetadata,
  handleExplainEntity,
  handleBuildQuery,
  setMetadataFetcher,
} from '../src/handlers.js'
import { setMetadataCache } from '../src/metadata/service.js'
import { MetadataCache } from '../src/metadata/cache.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureXml = readFileSync(join(__dirname, 'fixtures', 'metadata.xml'), 'utf-8')

function withTempConfig(run: (configPath: string, cacheDir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'onec-mcp-'))
  const configPath = join(dir, 'onec-config.json')
  const cacheDir = join(dir, 'cache')
  // Чистим все ONEC_*: иначе getConfig берёт настоящую базу из окружения разработчика,
  // и «тест без конфига» уходит в сеть с реальными учётными данными.
  const saved = new Map<string, string | undefined>()
  for (const name of Object.keys(process.env).filter((n) => n.startsWith('ONEC_'))) {
    saved.set(name, process.env[name])
    delete process.env[name]
  }
  process.env.ONEC_CONFIG_PATH = configPath

  return run(configPath, cacheDir).finally(() => {
    delete process.env.ONEC_CONFIG_PATH
    for (const [name, value] of saved) {
      if (value !== undefined) process.env[name] = value
    }
    setMetadataFetcher(null)
    setMetadataCache(null)
    rmSync(dir, { recursive: true, force: true })
  })
}

test('handleConfig without config returns setup instructions', async () => {
  await withTempConfig(async () => {
    const raw = await handleConfig({})
    const parsed = JSON.parse(raw)
    assert.equal(parsed.configured, false)
    assert.ok(parsed.instructions)
    assert.ok(parsed.configPath.includes('onec-config.json'))
  })
})

test('handlers return config error when not configured', async () => {
  await withTempConfig(async () => {
    for (const handler of [handleListEntities, handleMetadata, handleExplainEntity, handleBuildQuery]) {
      const raw = await handler({ entity: 'Catalog_Контрагенты' })
      const parsed = JSON.parse(raw)
      assert.ok(parsed.error || parsed.instructions)
    }
  })
})

test('metadata + explain + build_query smoke on fixture', async () => {
  await withTempConfig(async (configPath, cacheDir) => {
    writeFileSync(
      configPath,
      JSON.stringify({
        baseUrl: 'https://mock.test/db/odata/standard.odata',
        username: 'u',
        password: 'p',
        database: 'db',
      }),
    )

    setMetadataFetcher(async () => fixtureXml)
    setMetadataCache(new MetadataCache({ cacheDir, ttlMs: 3600000 }))

    const metaRaw = await handleMetadata({})
    const meta = JSON.parse(metaRaw)
    assert.ok(meta.totalEntitySets >= 5)

    const explainRaw = await handleExplainEntity({ entity: 'Catalog_Контрагенты' })
    const explain = JSON.parse(explainRaw)
    assert.equal(explain.name, 'Catalog_Контрагенты')
    assert.ok(explain.properties.some((p: { name: string }) => p.name === 'ИНН'))

    const buildRaw = await handleBuildQuery({
      entity: 'Document_SalesOrder',
      filters: [{ field: 'Posted', operator: 'eq', value: true }],
      top: 3,
    })
    const built = JSON.parse(buildRaw)
    assert.equal(built.entity, 'Document_SalesOrder')
    assert.ok(built.readyForOdataQuery.filter)
  })
})

test('odata_list_entities mock fetch smoke', async () => {
  await withTempConfig(async (configPath) => {
    writeFileSync(
      configPath,
      JSON.stringify({
        baseUrl: 'https://mock.test/db/odata/standard.odata',
        username: 'u',
        password: 'p',
      }),
    )

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('standard.odata')) {
        return new Response(JSON.stringify({ value: [{ name: 'Catalog_Контрагенты' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    try {
      const raw = await handleListEntities({})
      const parsed = JSON.parse(raw)
      assert.ok(Array.isArray(parsed.value), `expected value array, got: ${raw.slice(0, 200)}`)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
