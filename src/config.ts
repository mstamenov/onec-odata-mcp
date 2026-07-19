import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { OneCConfig } from './types.js'
import { CONFIG_SETUP_INSTRUCTIONS } from './types.js'

export function getConfigPath(): string {
  return process.env.ONEC_CONFIG_PATH ?? join(homedir(), '.onec-odata', 'onec-config.json')
}

/** @deprecated use getConfigPath() — kept for messages */
export const CONFIG_PATH = getConfigPath()

/**
 * Resolve the 1C OData connection config.
 *
 * Precedence:
 *   1. Environment variables (recommended for MCP clients and containers):
 *        ONEC_BASE_URL, ONEC_USERNAME, ONEC_PASSWORD,
 *        ONEC_DATABASE (optional), ONEC_METADATA_CACHE_TTL_MS (optional)
 *   2. JSON config file at getConfigPath() (~/.onec-odata/onec-config.json by default)
 */
export function getConfig(): OneCConfig | null {
  if (process.env.ONEC_BASE_URL && process.env.ONEC_USERNAME) {
    const env: OneCConfig = {
      baseUrl: process.env.ONEC_BASE_URL,
      username: process.env.ONEC_USERNAME,
      password: process.env.ONEC_PASSWORD ?? '',
    }
    if (process.env.ONEC_DATABASE) env.database = process.env.ONEC_DATABASE
    if (process.env.ONEC_METADATA_CACHE_TTL_MS) {
      env.metadataCacheTtlMs = Number(process.env.ONEC_METADATA_CACHE_TTL_MS)
    }
    if (process.env.ONEC_WRITABLE === 'true' || process.env.ONEC_WRITABLE === '1') {
      env.writable = true
    }
    return env
  }

  const configPath = getConfigPath()
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as OneCConfig
  } catch {
    return null
  }
}

export function configMissingResponse(): string {
  return JSON.stringify(
    {
      error: '1С OData не настроен',
      configPath: getConfigPath(),
      instructions: CONFIG_SETUP_INSTRUCTIONS,
      fix: 'Set ONEC_BASE_URL / ONEC_USERNAME / ONEC_PASSWORD env vars, or create ~/.onec-odata/onec-config.json',
    },
    null,
    2,
  )
}

export function metadataCacheKey(config: OneCConfig): string {
  const base = config.baseUrl.replace(/\/$/, '')
  const db = config.database ?? 'default'
  return `${base}::${db}`
}
