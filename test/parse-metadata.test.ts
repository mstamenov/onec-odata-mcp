import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMetadataXml,
  getEntityType,
  explainEntity,
  listResolvableEntityNames,
} from '../src/metadata/parse-metadata.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureXml = readFileSync(join(__dirname, 'fixtures', 'metadata.xml'), 'utf-8')

test('parseMetadataXml extracts entity types with Cyrillic names', () => {
  const meta = parseMetadataXml(fixtureXml)
  assert.ok(getEntityType(meta, 'Catalog_Контрагенты'))
  assert.ok(getEntityType(meta, 'Document_SalesOrder'))
  assert.ok(getEntityType(meta, 'Document_ПлатежноеПоручение'))
})

test('parseMetadataXml extracts properties, keys, navigation', () => {
  const meta = parseMetadataXml(fixtureXml)
  const entity = getEntityType(meta, 'Catalog_Контрагенты')!
  assert.deepEqual(entity.keys, ['Ref_Key'])
  assert.ok(entity.properties.some((p) => p.name === 'Description' && p.type === 'Edm.String'))
  assert.ok(entity.properties.some((p) => p.name === 'ИНН'))
  assert.equal(entity.navigationProperties.length, 0)

  const payment = getEntityType(meta, 'Document_ПлатежноеПоручение')!
  assert.ok(payment.navigationProperties.some((n) => n.name === 'Контрагент'))
})

test('parseMetadataXml maps entity sets', () => {
  const meta = parseMetadataXml(fixtureXml)
  assert.equal(meta.entitySets.get('Catalog_Контрагенты'), 'Catalog_Контрагенты')
  assert.equal(listResolvableEntityNames(meta).length, 6)
})

test('explainEntity returns field summary', () => {
  const meta = parseMetadataXml(fixtureXml)
  const explained = explainEntity(meta, 'Document_СчетНаОплатуПокупателю')
  assert.ok(explained)
  assert.ok(explained!.properties.some((p) => p.name === 'СуммаДокумента'))
})
