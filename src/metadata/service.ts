import type { OneCConfig, ODataMetadata } from '../types.js'
import { DEFAULT_METADATA_CACHE_TTL_MS } from '../types.js'
import { metadataCacheKey } from '../config.js'
import { buildODataUrl } from '../url.js'
import { MetadataCache } from './cache.js'
import { parseMetadataXml, summarizeMetadata } from './parse-metadata.js'

export type MetadataFetcher = (config: OneCConfig) => Promise<string>

let sharedCache: MetadataCache | null = null

export function setMetadataCache(cache: MetadataCache | null): void {
  sharedCache = cache
}

export function getMetadataCache(config: OneCConfig): MetadataCache {
  if (sharedCache) return sharedCache
  return new MetadataCache({
    ttlMs: config.metadataCacheTtlMs ?? DEFAULT_METADATA_CACHE_TTL_MS,
  })
}

export async function defaultMetadataFetcher(config: OneCConfig): Promise<string> {
  const url = buildODataUrl(config.baseUrl, '$metadata')
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/xml' },
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} при зареждане на $metadata`)
  }

  return res.text()
}

export async function loadMetadata(
  config: OneCConfig,
  fetcher: MetadataFetcher = defaultMetadataFetcher,
  forceRefresh = false,
): Promise<ODataMetadata> {
  const cacheKey = metadataCacheKey(config)
  const cache = getMetadataCache(config)

  if (!forceRefresh) {
    const cached = cache.getParsed(cacheKey)
    if (cached) return cached
  } else {
    cache.invalidate(cacheKey)
  }

  const xml = await fetcher(config)
  cache.set(cacheKey, xml)
  const parsed = parseMetadataXml(xml)
  parsed.fetchedAt = Date.now()
  parsed.cacheKey = cacheKey
  return parsed
}

export async function getMetadataSummary(
  config: OneCConfig,
  fetcher?: MetadataFetcher,
): Promise<ReturnType<typeof summarizeMetadata> & { fromCache: boolean; cacheKey: string }> {
  const cacheKey = metadataCacheKey(config)
  const cache = getMetadataCache(config)
  const hadCache = Boolean(cache.get(cacheKey))

  const metadata = await loadMetadata(config, fetcher)
  return {
    ...summarizeMetadata(metadata),
    fromCache: hadCache,
    cacheKey,
  }
}

export function loadMetadataFromXml(xml: string, cacheKey?: string): ODataMetadata {
  const parsed = parseMetadataXml(xml)
  parsed.fetchedAt = Date.now()
  parsed.cacheKey = cacheKey
  return parsed
}
