# Contributing

Thanks for your interest in improving `onec-odata-mcp`.

## Development

```bash
npm install
npm run build     # type-check + emit to dist/
npm test          # node:test suite
```

The server is configured for tests via the `ONEC_CONFIG_PATH` environment variable
pointing at a temp config file — no live 1C connection is required to run the suite.
Tests that touch the config must clear every `ONEC_*` variable first; otherwise they
pick up a real base from the developer's environment and hit the network.

## Guidelines

- Keep dependencies minimal: runtime deps are limited to `@modelcontextprotocol/sdk`
  and `fast-xml-parser`. Justify any addition.
- Preserve read-only-by-default semantics — the only write path is `odata_write`, and it
  must stay gated behind `writable: true` plus an explicit `dryRun: false`.
- Every request URL goes through `src/url.ts` so it cannot leave the configured `baseUrl`.
- User-facing tool messages are in Bulgarian; tool descriptions and logs stay in English.
- Never log or surface credentials. Secret-like field names are already excluded
  from fuzzy suggestions; extend that pattern rather than printing raw values.
- Add or update tests for any behavior change in `src/query/` or `src/metadata/`.

## Pull requests

- One logical change per PR.
- Ensure `npm run build` and `npm test` pass on Node 18 and 20.
- Do not include real connection details, hostnames, or customer-specific entity
  names in commits, fixtures, or examples.
