#!/usr/bin/env node
/**
 * 1С OData MCP Server
 *
 * Provides access to 1С:Enterprise via OData protocol. Read-only by default;
 * odata_write performs real writes only with writable=true and dryRun=false.
 * Works with any 1С configuration that has an OData endpoint enabled.
 *
 * Auth: Basic (username:password)
 * Config: env vars (ONEC_BASE_URL / ONEC_USERNAME / ONEC_PASSWORD)
 *         or ~/.onec-odata/onec-config.json
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createRequire } from 'node:module'
import { isErrorPayload, toolDefinitions, toolHandlers } from './handlers.js'

// package.json лежит рядом с dist/ и с src/, так что версия не расходится с релизом.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const server = new Server({ name: 'onec-odata', version }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...toolDefinitions],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const handler = toolHandlers[name]
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }

  try {
    const result = await handler(args ?? {})
    return { content: [{ type: 'text', text: result }], isError: isErrorPayload(result) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('1С OData MCP Server running on stdio')
}

main().catch(console.error)
