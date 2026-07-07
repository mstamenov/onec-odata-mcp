import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { MetadataCache } from '../src/metadata/cache.js'
import { parseMetadataXml } from '../src/metadata/parse-metadata.js'

const sampleXml = '<?xml version="1.0"?><Edmx><DataServices><Schema><EntityType Name="Test"/></Schema></DataServices></Edmx>'

test('MetadataCache stores and retrieves within TTL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'onec-cache-'))
  try {
    const cache = new MetadataCache({ cacheDir: dir, ttlMs: 60_000 })
    const keyA = 'https://1c.test/db1/odata/standard.odata::db1'
    cache.set(keyA, sampleXml)
    const got = cache.get(keyA)
    assert.ok(got)
    assert.equal(got!.xml, sampleXml)

    const parsed = cache.getParsed(keyA)
    assert.ok(parsed)
    assert.ok(parsed!.entityTypes.has('Test'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('MetadataCache isolates keys by baseUrl+database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'onec-cache-'))
  try {
    const cache = new MetadataCache({ cacheDir: dir, ttlMs: 60_000 })
    const keyA = 'https://1c.test/db1/odata/standard.odata::db1'
    const keyB = 'https://1c.test/db2/odata/standard.odata::db2'
    cache.set(keyA, sampleXml)
    cache.set(keyB, '<?xml version="1.0"?><Edmx><DataServices><Schema><EntityType Name="Other"/></Schema></DataServices></Edmx>')

    const parsedA = cache.getParsed(keyA)!
    const parsedB = cache.getParsed(keyB)!
    assert.ok(parsedA.entityTypes.has('Test'))
    assert.ok(parsedB.entityTypes.has('Other'))
    assert.ok(!parsedA.entityTypes.has('Other'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('MetadataCache invalidates expired entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'onec-cache-'))
  try {
    const cache = new MetadataCache({ cacheDir: dir, ttlMs: 1 })
    const key = 'https://1c.test/db/odata::default'
    cache.set(key, sampleXml)
    const start = Date.now()
    while (Date.now() - start < 5) {
      /* wait for expiry */
    }
    assert.equal(cache.get(key), null)
    cache.invalidate(key)
    assert.equal(cache.get(key), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseMetadataXml handles minimal xml', () => {
  const meta = parseMetadataXml(sampleXml)
  assert.ok(meta.entityTypes.has('Test'))
})
