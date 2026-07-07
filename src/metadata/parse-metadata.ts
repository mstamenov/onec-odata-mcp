import { XMLParser } from 'fast-xml-parser'
import type { ODataEntityType, ODataMetadata, ODataNavigationProperty, ODataProperty } from '../types.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) =>
    ['Property', 'NavigationProperty', 'PropertyRef', 'EntityType', 'EntitySet', 'Schema'].includes(name),
})

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function parseProperties(raw: unknown): ODataProperty[] {
  return asArray(raw as Record<string, string>[]).map((p) => ({
    name: String(p['@_Name'] ?? ''),
    type: String(p['@_Type'] ?? 'Edm.String'),
    nullable: p['@_Nullable'] !== 'false',
  }))
}

function parseNavigationProperties(raw: unknown): ODataNavigationProperty[] {
  return asArray(raw as Record<string, string>[]).map((p) => ({
    name: String(p['@_Name'] ?? ''),
    type: String(p['@_Type'] ?? ''),
    partner: p['@_Partner'] ? String(p['@_Partner']) : undefined,
  }))
}

function parseEntityType(raw: Record<string, unknown>): ODataEntityType | null {
  const name = String(raw['@_Name'] ?? '')
  if (!name) return null

  const keyBlock = raw.Key as Record<string, unknown> | undefined
  const keys = asArray(keyBlock?.PropertyRef as Record<string, string>[]).map((k) =>
    String(k['@_Name'] ?? ''),
  )

  return {
    name,
    keys,
    properties: parseProperties(raw.Property),
    navigationProperties: parseNavigationProperties(raw.NavigationProperty),
  }
}

/**
 * Parse OData $metadata EDMX XML into structured entity types and entity sets.
 */
export function parseMetadataXml(xml: string): ODataMetadata {
  const doc = parser.parse(xml)
  const entityTypes = new Map<string, ODataEntityType>()
  const entitySets = new Map<string, string>()

  const dataServices = doc?.Edmx?.DataServices ?? doc?.DataServices
  const schemas = asArray(dataServices?.Schema)

  for (const schema of schemas) {
    for (const et of asArray(schema.EntityType as Record<string, unknown>[])) {
      const parsed = parseEntityType(et)
      if (parsed) {
        const ns = String(schema['@_Namespace'] ?? '')
        entityTypes.set(parsed.name, parsed)
        if (ns) entityTypes.set(`${ns}.${parsed.name}`, parsed)
      }
    }

    for (const container of asArray(schema.EntityContainer as Record<string, unknown>[])) {
      for (const es of asArray(container.EntitySet as Record<string, string>[])) {
        const setName = String(es['@_Name'] ?? '')
        let entityType = String(es['@_EntityType'] ?? '')
        if (entityType.includes('.')) {
          entityType = entityType.split('.').pop() ?? entityType
        }
        if (setName && entityType) entitySets.set(setName, entityType)
      }
    }
  }

  return { entityTypes, entitySets }
}

export function summarizeMetadata(metadata: ODataMetadata) {
  const entitySetList = [...metadata.entitySets.entries()].map(([name, type]) => ({ name, type }))
  const uniqueTypes = new Map<string, ODataEntityType>()
  for (const et of metadata.entityTypes.values()) {
    if (!uniqueTypes.has(et.name)) uniqueTypes.set(et.name, et)
  }

  return {
    entitySets: entitySetList,
    totalEntityTypes: uniqueTypes.size,
    totalEntitySets: entitySetList.length,
    entityTypeNames: [...uniqueTypes.keys()].sort(),
  }
}

export function getEntityType(metadata: ODataMetadata, entityName: string): ODataEntityType | undefined {
  if (metadata.entityTypes.has(entityName)) return metadata.entityTypes.get(entityName)

  const fromSet = metadata.entitySets.get(entityName)
  if (fromSet && metadata.entityTypes.has(fromSet)) return metadata.entityTypes.get(fromSet)

  for (const et of metadata.entityTypes.values()) {
    if (et.name === entityName) return et
  }
  return undefined
}

export function listResolvableEntityNames(metadata: ODataMetadata): string[] {
  const names = new Set<string>()
  for (const [setName] of metadata.entitySets) names.add(setName)
  for (const et of metadata.entityTypes.values()) names.add(et.name)
  return [...names].sort()
}

export function explainEntity(metadata: ODataMetadata, entityName: string) {
  const entity = getEntityType(metadata, entityName)
  if (!entity) return null

  return {
    name: entity.name,
    keys: entity.keys,
    properties: entity.properties.map((p) => ({
      name: p.name,
      type: p.type,
      nullable: p.nullable ?? true,
    })),
    navigationProperties: entity.navigationProperties.map((n) => ({
      name: n.name,
      type: n.type,
      partner: n.partner,
    })),
    availableAsEntitySet: metadata.entitySets.has(entityName) || metadata.entitySets.has(entity.name),
  }
}
