import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ODataMetadata } from '../types.js'
import { DEFAULT_METADATA_CACHE_TTL_MS } from '../types.js'
import { parseMetadataXml } from './parse-metadata.js'

export type MetadataCacheEntry = {
  cacheKey: string
  fetchedAt: number
  xml: string
}

export type MetadataCacheOptions = {
  cacheDir?: string
  ttlMs?: number
}

const DEFAULT_CACHE_DIR = join(homedir(), '.onec-odata', 'cache', 'onec-metadata')

function cacheFilePath(cacheDir: string, cacheKey: string): string {
  const hash = createHash('sha256').update(cacheKey).digest('hex')
  return join(cacheDir, `${hash}.json`)
}

export class MetadataCache {
  readonly cacheDir: string
  readonly ttlMs: number

  constructor(options: MetadataCacheOptions = {}) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR
    this.ttlMs = options.ttlMs ?? DEFAULT_METADATA_CACHE_TTL_MS
    mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 })
  }

  get(cacheKey: string): MetadataCacheEntry | null {
    const filePath = cacheFilePath(this.cacheDir, cacheKey)
    if (!existsSync(filePath)) return null

    try {
      const entry = JSON.parse(readFileSync(filePath, 'utf-8')) as MetadataCacheEntry
      if (entry.cacheKey !== cacheKey) {
        this.invalidate(cacheKey)
        return null
      }
      if (Date.now() - entry.fetchedAt > this.ttlMs) {
        this.invalidate(cacheKey)
        return null
      }
      return entry
    } catch {
      this.invalidate(cacheKey)
      return null
    }
  }

  set(cacheKey: string, xml: string): MetadataCacheEntry {
    const entry: MetadataCacheEntry = { cacheKey, fetchedAt: Date.now(), xml }
    writeFileSync(cacheFilePath(this.cacheDir, cacheKey), JSON.stringify(entry), {
      encoding: 'utf-8',
      mode: 0o600,
    })
    return entry
  }

  invalidate(cacheKey: string): void {
    const filePath = cacheFilePath(this.cacheDir, cacheKey)
    if (existsSync(filePath)) unlinkSync(filePath)
  }

  getParsed(cacheKey: string): ODataMetadata | null {
    const entry = this.get(cacheKey)
    if (!entry) return null
    const parsed = parseMetadataXml(entry.xml)
    parsed.fetchedAt = entry.fetchedAt
    parsed.cacheKey = cacheKey
    return parsed
  }
}

export function createMetadataCache(options?: MetadataCacheOptions): MetadataCache {
  return new MetadataCache(options)
}
