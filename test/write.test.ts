import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleWrite } from '../src/handlers.js'

function withTempConfig(
  config: Record<string, unknown> | null,
  run: () => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'onec-write-'))
  const configPath = join(dir, 'onec-config.json')
  const prevConfig = process.env.ONEC_CONFIG_PATH
  const prevBase = process.env.ONEC_BASE_URL
  const prevUser = process.env.ONEC_USERNAME
  const prevPass = process.env.ONEC_PASSWORD
  const prevWritable = process.env.ONEC_WRITABLE

  // Prefer file config; clear env so getConfig does not short-circuit to env branch
  delete process.env.ONEC_BASE_URL
  delete process.env.ONEC_USERNAME
  delete process.env.ONEC_PASSWORD
  delete process.env.ONEC_WRITABLE
  process.env.ONEC_CONFIG_PATH = configPath

  if (config) {
    writeFileSync(configPath, JSON.stringify(config))
  }

  return run().finally(() => {
    if (prevConfig === undefined) delete process.env.ONEC_CONFIG_PATH
    else process.env.ONEC_CONFIG_PATH = prevConfig
    if (prevBase === undefined) delete process.env.ONEC_BASE_URL
    else process.env.ONEC_BASE_URL = prevBase
    if (prevUser === undefined) delete process.env.ONEC_USERNAME
    else process.env.ONEC_USERNAME = prevUser
    if (prevPass === undefined) delete process.env.ONEC_PASSWORD
    else process.env.ONEC_PASSWORD = prevPass
    if (prevWritable === undefined) delete process.env.ONEC_WRITABLE
    else process.env.ONEC_WRITABLE = prevWritable
    rmSync(dir, { recursive: true, force: true })
  })
}

const baseConfig = {
  baseUrl: 'https://mock.test/db/odata/standard.odata',
  username: 'u',
  password: 'p',
}

test('odata_write dry-run by default does not call fetch', async () => {
  await withTempConfig(baseConfig, async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('fetch must not be called in dry-run')
    }) as typeof fetch

    try {
      const raw = await handleWrite({
        entity: 'Catalog_Контрагенты',
        method: 'create',
        data: { Description: 'ООО Тест' },
      })
      const parsed = JSON.parse(raw)
      assert.equal(parsed.dryRun, true)
      assert.ok(parsed.wouldExecute)
      assert.equal(parsed.wouldExecute.method, 'create')
      assert.equal(parsed.wouldExecute.entity, 'Catalog_Контрагенты')
      assert.ok(String(parsed.wouldExecute.url).includes('Catalog_Контрагенты'))
      assert.deepEqual(parsed.wouldExecute.body, { Description: 'ООО Тест' })
      assert.ok(parsed.note)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('odata_write dryRun:false with writable:false returns error without fetch', async () => {
  await withTempConfig({ ...baseConfig, writable: false }, async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('fetch must not be called when writable is false')
    }) as typeof fetch

    try {
      const raw = await handleWrite({
        entity: 'Catalog_Контрагенты',
        method: 'update',
        key: "guid'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'",
        data: { Description: 'Новое имя' },
        dryRun: false,
      })
      const parsed = JSON.parse(raw)
      assert.ok(parsed.error)
      assert.match(parsed.error, /writable=false/)
      assert.ok(parsed.hint)
      assert.equal(parsed.entity, 'Catalog_Контрагенты')
      assert.equal(parsed.method, 'update')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('odata_write dryRun:false with writable:true performs fetch', async () => {
  await withTempConfig({ ...baseConfig, writable: true }, async () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    let lastInit: RequestInit | undefined

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1
      lastInit = init
      return new Response(JSON.stringify({ Ref_Key: 'new-key', Description: 'ООО Тест' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    try {
      const raw = await handleWrite({
        entity: 'Catalog_Контрагенты',
        method: 'create',
        data: { Description: 'ООО Тест' },
        dryRun: false,
      })
      const parsed = JSON.parse(raw)
      assert.equal(fetchCalls, 1)
      assert.equal(lastInit?.method, 'POST')
      assert.equal(parsed.Description, 'ООО Тест')
      assert.ok(!parsed.error)
      assert.ok(!parsed.dryRun)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
