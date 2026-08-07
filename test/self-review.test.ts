import test from 'node:test'
import assert from 'node:assert/strict'
import { fuzzySuggestions, isSecretFieldName } from '../src/query/fuzzy.js'
import { encodeODataQueryParams } from '../src/query/filter-format.js'
import { metadataCacheKey } from '../src/config.js'

test('self-review: Cyrillic filter is URL-encoded in query string', () => {
  const qs = encodeODataQueryParams({ $filter: "Description eq 'ООО Ромашка'" })
  assert.match(qs, /%D0/)
  const decoded = decodeURIComponent(qs.split('=').slice(1).join('='))
  assert.ok(decoded.includes('Ромашка'))
})

test('self-review: metadata cache key scopes by baseUrl and database', () => {
  const a = metadataCacheKey({
    baseUrl: 'https://1c/a/odata/standard.odata',
    username: 'u',
    password: 'p',
    database: 'db1',
  })
  const b = metadataCacheKey({
    baseUrl: 'https://1c/b/odata/standard.odata',
    username: 'u',
    password: 'p',
    database: 'db2',
  })
  assert.notEqual(a, b)
})

test('self-review: fuzzy never suggests secret-like field names', () => {
  const candidates = ['Description', 'UserPassword', 'ApiSecretToken', 'ИНН', 'SecretNote']
  const suggestions = fuzzySuggestions('Pass', candidates, { limit: 5 })
  assert.ok(suggestions.every((s) => !isSecretFieldName(s)))
  assert.ok(!suggestions.includes('UserPassword'))
})

// Версия в server.json — это то, что читает MCP Registry. Она уже разъезжалась: пакет
// был 1.1.1, манифест объявлял 1.0.1, то есть листинг указывал на выпуск двухлетней
// давности по счёту релизов. Число руками не удержать — держим тестом.
test('server.json объявляет ту же версию, что package.json', async () => {
  const [pkg, srv] = await Promise.all([
    import('../package.json', { with: { type: 'json' } }),
    import('../server.json', { with: { type: 'json' } }),
  ]);
  const want = (pkg as any).default.version;
  const manifest = (srv as any).default;
  assert.equal(manifest.version, want, 'server.json.version отстал от package.json');
  for (const p of manifest.packages ?? []) {
    assert.equal(p.version, want, `packages[].version (${p.identifier}) отстал от package.json`);
  }
});
