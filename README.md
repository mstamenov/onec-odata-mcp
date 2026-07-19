# onec-odata-mcp

[![npm](https://img.shields.io/npm/v/onec-odata-mcp.svg)](https://www.npmjs.com/package/onec-odata-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-blue)](https://github.com/modelcontextprotocol/registry)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## Подключи 1С к Claude за 5 минут

Даёт Claude (Desktop, Code, любой MCP-клиент) доступ на чтение к базе 1С:Предприятие через стандартный OData. Вместо выгрузки в Excel или ручного написания OData-урлов — спрашиваешь по-русски, получаешь структурированные данные из справочников и документов.

Работает с любой конфигурацией 1С, где опубликован OData (Бухгалтерия, ERP, Управление торговлей, самописные конфигурации).

> 📸 TODO: скриншот/видео 5-минутной настройки — добавить после первого прогона с реальной базой.

### Шаг 1 — установка

Ничего ставить локально не нужно, `npx` подтянет пакет при первом запуске:

```bash
npx -y onec-odata-mcp
```

(Для разработки из исходников: `npm install && npm run build`.)

### Шаг 2 — подключи к Claude

**Вариант А — командой `claude mcp add` (Claude Code):**

```bash
claude mcp add onec-odata \
  -e ONEC_BASE_URL=https://1c.example.com/your_db/odata/standard.odata \
  -e ONEC_USERNAME=odata_user \
  -e ONEC_PASSWORD=your_password \
  -- npx -y onec-odata-mcp
```

**Вариант Б — вручную в `claude_desktop_config.json`** (Claude Desktop: Settings → Developer → Edit Config):

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

Готовый сниппет лежит в [`examples/claude_desktop_config.json`](./examples/claude_desktop_config.json).

Опционально: `ONEC_DATABASE` (подсказка имени базы), `ONEC_METADATA_CACHE_TTL_MS` (TTL кэша метаданных, по умолчанию 1 час). Либо вместо переменных окружения — JSON-файл `~/.onec-odata/onec-config.json` с полями `baseUrl`, `username`, `password`, путь к которому задаётся через `ONEC_CONFIG_PATH`.

### Шаг 3 — первый запрос

Перезапусти Claude и спроси:

> «Какие справочники и документы есть в базе 1С?»

Claude вызовет `odata_list_entities`, увидит список и дальше сам подберёт нужные инструменты под конкретный вопрос — без знания синтаксиса OData с твоей стороны.

Больше готовых промптов — в [`examples/prompts.md`](./examples/prompts.md).

## Инструменты

| Инструмент | Что делает | Пример вопроса |
|---|---|---|
| `odata_config` | Проверяет статус подключения и настройки | «Проверь, подключена ли 1С» |
| `odata_list_entities` | Список всех доступных OData-сущностей | «Какие справочники и документы есть в базе?» |
| `odata_metadata` | Типы и наборы сущностей из `$metadata` (кэш, TTL 1ч) | вызывается автоматически перед сложными запросами |
| `odata_explain_entity` | Поля, типы, ключи, связи конкретной сущности | «Какие поля у справочника Контрагенты?» |
| `odata_build_query` | Строит и проверяет `$filter`/`$select`/`$orderby` из структурированных параметров запроса | вызывается автоматически — Claude сам переводит «за июнь» в даты, тул собирает и валидирует фильтр |
| `odata_query` | Запрос к сущности с готовыми OData-параметрами | «Покажи остатки по счёту 51 за июнь» |
| `odata_count` | Количество записей, опционально с фильтром | «Сколько контрагентов зарегистрировано в этом году?» |
| `odata_financial_summary` | Автообнаружение типовых финансовых сущностей + счётчики | «Дай сводку по счетам, реализациям и контрагентам» |

Обычно агент сам комбинирует `odata_build_query` → `odata_query`/`odata_count`, тебе достаточно спросить своими словами.

## Безопасность

- **Только чтение.** Под капотом сервер шлёт исключительно HTTP `GET` (`src/odata-client.ts`) — ни одного `POST`/`PATCH`/`DELETE` к базе 1С нет в коде. Случайно изменить данные через этот MCP нельзя.
- **Пароль** передаётся Basic Auth (base64 в заголовке каждого запроса — как требует OData) и хранится либо в env-переменных конфига твоего MCP-клиента (рекомендуется), либо в локальном файле `~/.onec-odata/onec-config.json`. Сервер не логирует и не возвращает пароль в ответах инструментов.
- **Поля-секреты** (`password`, `token`, `apikey`, `secret` и т.п. в названиях) автоматически исключены из подсказок «возможно, вы имели в виду» (`src/query/fuzzy.ts`), чтобы агент не подсвечивал их случайно.
- **Рекомендация:** заведи в 1С отдельного OData-пользователя с ролью только на чтение, не используй административную учётку.

## Требования

- Node.js ≥ 18
- 1С:Предприятие с опубликованным OData-интерфейсом (веб-публикация → `standard.odata`)

## Разработка

```bash
npm install
npm run build   # type-check + сборка в dist/
npm test
```

Детали и правила вклада — в [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

---

## English (short)

MCP server giving Claude (or any MCP client) **read-only** access to a 1C:Enterprise database via its standard OData endpoint. No spreadsheet exports, no hand-written OData URLs — ask in natural language, get structured data from catalogs and documents.

```bash
npx -y onec-odata-mcp
```

Configure via `ONEC_BASE_URL` / `ONEC_USERNAME` / `ONEC_PASSWORD` env vars (see the Russian quick-start above for `claude mcp add` and `claude_desktop_config.json` snippets — the JSON is language-agnostic). Only HTTP `GET` requests are ever made; the server cannot mutate 1C data. Published on npm as [`onec-odata-mcp`](https://www.npmjs.com/package/onec-odata-mcp) and listed in the official MCP Registry as `io.github.alexgrebeshok-coder/onec-odata-mcp`.
