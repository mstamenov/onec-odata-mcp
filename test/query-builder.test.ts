import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMetadataXml } from '../src/metadata/parse-metadata.js'
import { buildODataQuery } from '../src/query/builder.js'
import { fuzzySuggestions, isSecretFieldName } from '../src/query/fuzzy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureXml = readFileSync(join(__dirname, 'fixtures', 'metadata.xml'), 'utf-8')
const metadata = parseMetadataXml(fixtureXml)

test('buildODataQuery positive: filters + top + order + select', () => {
  const result = buildODataQuery(
    {
      entity: 'Catalog_Контрагенты',
      filters: [{ field: 'Description', operator: 'eq', value: 'ООО Ромашка' }],
      top: 10,
      orderBy: [{ field: 'Description', direction: 'asc' }],
      select: ['Description', 'ИНН'],
    },
    metadata,
  )

  assert.equal(result.entity, 'Catalog_Контрагенты')
  assert.ok(result.queryParams.filter?.includes("Description eq 'ООО Ромашка'"))
  assert.equal(result.queryParams.top, 10)
  assert.equal(result.queryParams.select, 'Description,ИНН')
  assert.ok(result.explanation.includes('Сущность'))
})

test('buildODataQuery negative: unknown entity with fuzzy hint', () => {
  assert.throws(
    () =>
      buildODataQuery(
        { entity: 'Catalog_Контрагент' /* typo */ },
        metadata,
      ),
    (err: Error) => {
      assert.match(err.message, /не найдена/)
      assert.match(err.message, /Возможно/)
      return true
    },
  )
})

test('buildODataQuery negative: unknown field with fuzzy hint', () => {
  assert.throws(
    () =>
      buildODataQuery(
        {
          entity: 'Catalog_Контрагенты',
          filters: [{ field: 'Descrition', operator: 'eq', value: 'x' }],
        },
        metadata,
      ),
    /Descrition/,
  )
})

test('fuzzySuggestions excludes secret field names', () => {
  const candidates = ['Description', 'UserPassword', 'ApiSecretToken', 'ИНН']
  const suggestions = fuzzySuggestions('Descr', candidates)
  assert.ok(suggestions.includes('Description'))
  assert.ok(!suggestions.some((s) => isSecretFieldName(s)))
})

test('buildODataQuery payment document with date filter', () => {
  const result = buildODataQuery(
    {
      entity: 'Document_ПлатежноеПоручение',
      datePeriod: { field: 'Date', from: '2025-05-01', to: '2025-05-31' },
      filters: [{ field: 'Posted', operator: 'eq', value: true }],
      top: 5,
    },
    metadata,
  )
  assert.ok(result.queryParams.filter?.includes("datetime'2025-05-01T00:00:00'"))
  assert.ok(result.queryParams.filter?.includes('Posted eq true') || result.queryParams.filter?.includes('(Posted eq true)'))
})
