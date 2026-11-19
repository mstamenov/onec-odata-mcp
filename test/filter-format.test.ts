import test from 'node:test'
import assert from 'node:assert/strict'
import {
  escapeODataString,
  formatDateTimeLiteral,
  formatODataLiteral,
  encodeODataQueryParams,
  buildFilterComparison,
} from '../src/query/filter-format.js'

test('formatDateTimeLiteral produces datetime quote form', () => {
  assert.equal(formatDateTimeLiteral('2024-06-15'), "datetime'2024-06-15T00:00:00'")
  assert.equal(formatDateTimeLiteral('2024-06-15T12:30:00'), "datetime'2024-06-15T12:30:00'")
})

test('formatODataLiteral guid', () => {
  const literal = formatODataLiteral('a1b2c3d4-e5f6-7890-abcd-ef1234567890', {
    name: 'Ref_Key',
    type: 'Edm.Guid',
  })
  assert.equal(literal, "guid'a1b2c3d4-e5f6-7890-abcd-ef1234567890'")
})

test('escapeODataString doubles single quotes', () => {
  assert.equal(escapeODataString("O'Reilly"), "O''Reilly")
})

test('formatODataLiteral Cyrillic string', () => {
  const literal = formatODataLiteral('ООО Ромашка', { name: 'Description', type: 'Edm.String' })
  assert.equal(literal, "'ООО Ромашка'")
})

test('encodeODataQueryParams URL-encodes Cyrillic filter', () => {
  const qs = encodeODataQueryParams({
    $filter: "Description eq 'ООО Ромашка'",
  })
  assert.ok(qs.includes('%24filter='))
  assert.ok(qs.includes('%D0%9E%D0%9E%D0%9E') || qs.includes('ООО'))
  const decoded = decodeURIComponent(qs.replace('$filter=', '').replace('%24filter=', ''))
  assert.ok(decoded.includes('Ромашка'))
})

test('buildFilterComparison contains operator uses OData v3 substringof', () => {
  assert.equal(
    buildFilterComparison('Description', 'contains', "'test'"),
    "substringof('test',Description) eq true",
  )
})

test('formatDateTimeLiteral accepts an already wrapped literal', () => {
  assert.equal(formatDateTimeLiteral("datetime'2024-06-15T12:30:00'"), "datetime'2024-06-15T12:30:00'")
})

test('formatDateTimeLiteral rejects anything that is not a strict date', () => {
  for (const bad of [
    "datetime'2024-01-01T00:00:00' or 1 eq 1 or Date eq datetime'2024-01-01T00:00:00'",
    "2024-01-01T' or 1 eq 1 or Date eq datetime'2024-01-01",
    '2024-01-01T00:00:00 or true',
    'вчера',
  ]) {
    assert.throws(() => formatDateTimeLiteral(bad), /Невалиден формат на дата/, bad)
  }
})
