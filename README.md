# onec-odata-mcp

> MCP server bridging AI agents to 1C:Enterprise (1С:Предприятие) via OData.

Give an AI assistant (Claude Desktop, Cursor, any MCP client) read-only access to a 1C database. Instead of exporting spreadsheets or hand-writing OData URLs, the agent queries 1C entities — counterparties, documents, invoices, catalogs — in natural language and gets structured data back. Works with any 1C configuration that exposes the standard OData endpoint (Accounting, ERP, Trade Management, and custom configs).

## Quick start

```bash
npm install
npm run build
```

Configure via **environment variables** (recommended for MCP clients):

```
ONEC_BASE_URL=https://1c.example.com/your_db/odata/standard.odata
ONEC_USERNAME=odata_user
ONEC_PASSWORD=odata_password
# optional:
ONEC_DATABASE=your_db
ONEC_METADATA_CACHE_TTL_MS=3600000
```

Register the server in your MCP client (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "onec-odata": {
      "command": "npx",
      "args": ["-y", "onec-odata-mcp"],
      "env": {
        "ONEC_BASE_URL": "https://1c.example.com/your_db/odata/standard.odata",
        "ONEC_USERNAME": "odata_user",
        "ONEC_PASSWORD": "your_password"
      }
    }
  }
}
```

Alternatively, place a JSON file at `~/.onec-odata/onec-config.json` with `{ "baseUrl", "username", "password" }` and point `ONEC_CONFIG_PATH` at it.

## Tools

| Tool | Description |
|------|-------------|
| `odata_config` | Check configuration status and setup instructions |
| `odata_list_entities` | List all available OData entities |
| `odata_metadata` | Get entity types and sets from `$metadata` (cached, 1h TTL) |
| `odata_explain_entity` | Describe an entity's fields, types, keys, navigation properties |
| `odata_build_query` | Build a validated `$filter`/`$select`/`$orderby` from structured intent |
| `odata_query` | Query an entity with raw OData params (filter/select/top/expand) |
| `odata_count` | Count records in an entity, optionally filtered |
| `odata_financial_summary` | Auto-detect common financial entities and report their counts |

## Example

Ask the agent: *"How many sales orders were posted this month?"*

It calls `odata_build_query` → `odata_count` on the sales-order entity with a date filter. No OData syntax knowledge required — the server validates fields against live `$metadata` and rejects unknown/secret fields.

## Requirements

- Node.js ≥ 18
- 1C:Enterprise with the OData endpoint published (web publishing → `standard.odata`)

## License

MIT
