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
    const ttl = Number(process.env.ONEC_METADATA_CACHE_TTL_MS)
    if (process.env.ONEC_METADATA_CACHE_TTL_MS && Number.isFinite(ttl) && ttl >= 0) {
      env.metadataCacheTtlMs = ttl
    }
    if (process.env.ONEC_WRITABLE === 'true' || process.env.ONEC_WRITABLE === '1') {
      env.writable = true
    }
    return env
  }

  const configPath = getConfigPath()
  if (!existsSync(configPath)) return null
  try {
    return normalizeFileConfig(JSON.parse(readFileSync(configPath, 'utf-8')))
  } catch {
    return null
  }
}

/**
 * Файл конфигурации — недоверенный по типам JSON. Берём только известные поля и только
 * ожидаемых типов; в частности запись включает лишь булево `true`, а не строка "false".
 */
export function normalizeFileConfig(raw: unknown): OneCConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.baseUrl !== 'string' || !r.baseUrl) return null
  if (typeof r.username !== 'string' || !r.username) return null

  const config: OneCConfig = {
    baseUrl: r.baseUrl,
    username: r.username,
    password: typeof r.password === 'string' ? r.password : '',
  }
  if (typeof r.database === 'string' && r.database) config.database = r.database
  if (typeof r.metadataCacheTtlMs === 'number' && Number.isFinite(r.metadataCacheTtlMs) && r.metadataCacheTtlMs >= 0) {
    config.metadataCacheTtlMs = r.metadataCacheTtlMs
  }
  if (r.writable === true) config.writable = true
  return config
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
