# onec-odata-mcp

[![npm](https://img.shields.io/npm/v/onec-odata-mcp.svg)](https://www.npmjs.com/package/onec-odata-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-blue)](https://github.com/modelcontextprotocol/registry)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## Свържи 1С с Claude за 5 минути

Дава на Claude (Desktop, Code, всеки MCP клиент) достъп за четене до база на 1С:Предприятие през стандартния OData интерфейс. Вместо експорт в Excel или ръчно писане на OData адреси — питаш на български и получаваш структурирани данни от справочниците и документите.

Работи с всяка конфигурация на 1С, в която е публикуван OData (Бухгалтерия, ERP, Управление торговлей, собствени конфигурации).

> 📸 TODO: екранна снимка/видео на 5-минутната настройка — да се добави след първото пускане срещу реална база.

### Стъпка 1 — инсталация

Нищо не е нужно да се инсталира локално, `npx` ще изтегли пакета при първото стартиране:

```bash
npx -y onec-odata-mcp
```

Задай `ONEC_BASE_URL`, `ONEC_USERNAME` и `ONEC_PASSWORD` в конфигурацията на твоя MCP клиент (виж по-долу).

**От изходния код** (със заключените версии на зависимостите):

```bash
npm ci
npm run build
node dist/index.js
```

### Стъпка 2 — свържи с Claude

**Вариант А — с командата `claude mcp add` (Claude Code):**

```bash
claude mcp add onec-odata \
  -e ONEC_BASE_URL=https://1c.example.com/your_db/odata/standard.odata \
  -e ONEC_USERNAME=odata_user \
  -e ONEC_PASSWORD=your_password \
  -- npx -y onec-odata-mcp
```

**Вариант Б — ръчно в `claude_desktop_config.json`** (Claude Desktop: Settings → Developer → Edit Config):

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

Готов пример има в [`examples/claude_desktop_config.json`](./examples/claude_desktop_config.json).

По избор: `ONEC_DATABASE` (подсказка за името на базата), `ONEC_METADATA_CACHE_TTL_MS` (TTL на кеша с метаданни, по подразбиране 1 час), `ONEC_WRITABLE=true` (разрешава реален запис през `odata_write`; по подразбиране false). Вместо променливи на средата може да се ползва JSON файл `~/.onec-odata/onec-config.json` с полета `baseUrl`, `username`, `password` (и по избор `"writable": true`); пътят до него се задава с `ONEC_CONFIG_PATH`.

### Стъпка 3 — първа заявка

Рестартирай Claude и попитай:

> „Какви справочници и документи има в базата на 1С?“

Claude ще извика `odata_list_entities`, ще види списъка и нататък сам ще подбира нужните инструменти според въпроса — без да е нужно ти да знаеш синтаксиса на OData.

Още готови въпроси има в [`examples/prompts.md`](./examples/prompts.md).

## Инструменти

| Инструмент | Какво прави | Примерен въпрос |
|---|---|---|
| `odata_config` | Проверява състоянието на връзката и настройките | „Провери дали 1С е свързана“ |
| `odata_list_entities` | Списък на всички достъпни OData обекти | „Какви справочници и документи има в базата?“ |
| `odata_metadata` | Типове и набори от обекти от `$metadata` (кеш, TTL 1 ч) | извиква се автоматично преди сложни заявки |
| `odata_explain_entity` | Полета, типове, ключове и връзки на конкретен обект | „Какви полета има справочникът Контрагенты?“ |
| `odata_build_query` | Съставя и проверява `$filter`/`$select`/`$orderby` от структурирани параметри | извиква се автоматично — Claude сам превръща „за юни“ в дати, инструментът сглобява и валидира филтъра |
| `odata_query` | Заявка към обект с готови OData параметри; без `top` връща най-много 100 записа | „Покажи салдата по сметка 51 за юни“ |
| `odata_count` | Брой записи, по избор с филтър | „Колко контрагенти са регистрирани тази година?“ |
| `odata_write` | Създаване/промяна/изтриване на запис (POST/PATCH/DELETE) | „Създай контрагент…“ — първо преглед в dry-run |

Обикновено агентът сам комбинира `odata_build_query` → `odata_query`/`odata_count`; на теб ти е достатъчно да попиташ със свои думи.

Съобщенията, които инструментите връщат (грешки, подсказки, предупреждения), са на български.

## Сигурност

- **По подразбиране само четене.** Флагът `writable` в конфигурацията на базата (env `ONEC_WRITABLE=true` / `"writable": true` в `~/.onec-odata/onec-config.json`) по подразбиране е **false**. Без него реални `POST`/`PATCH`/`DELETE` не се изпращат към 1С.
- **Запис — само през `odata_write`.** `dryRun` по подразбиране е **true**: винаги първо преглед `{dryRun: true, wouldExecute: …}` без мрежова заявка. Реалният запис изисква **и** `writable: true` за тази база, **и** изрично `dryRun: false`.
- **Заявките не излизат извън `baseUrl`.** Името на обекта и ключът се проверяват, а крайният адрес трябва да остане на същия хост и под пътя на базата — иначе заявката не се изпраща. `odata_write` приема само просто име на обект (без пътища и извиквания на действия), а dry-run показва точно адреса, на който ще отиде записът.
- **`writable` в JSON файла се включва само с булево `true`** — низът `"false"` или `"true"` не разрешава запис.
- **`http://` вместо `https://`** към нелокален хост: `odata_config` връща предупреждение, че паролата се предава в явен вид.
- **Паролата** се предава с Basic Auth (base64 в заглавката на всяка заявка — както изисква OData) и се пази или в променливите на средата в конфигурацията на твоя MCP клиент (препоръчително), или в локалния файл `~/.onec-odata/onec-config.json`. Сървърът не записва паролата в логове и не я връща в отговорите на инструментите.
- **Полета-тайни** (`password`, `token`, `apikey`, `secret` и подобни в имената) автоматично се изключват от подсказките „може би имахте предвид“ (`src/query/fuzzy.ts`), за да не ги показва агентът случайно.
- **Препоръка:** създай в 1С отделен OData потребител с роля само за четене за обичайната работа; потребител с права за запис и `ONEC_WRITABLE=true` включвай само съзнателно.

## Изисквания

- Node.js ≥ 18
- 1С:Предприятие с публикуван OData интерфейс (уеб публикация → `standard.odata`)

## Разработка

```bash
npm install
npm run build   # проверка на типовете + компилация в dist/
npm test
```

Подробности и правила за принос — в [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

---

## English (short)

MCP server giving Claude (or any MCP client) access to a 1C:Enterprise database via its standard OData endpoint. **Read-only by default** (`writable: false`); writes go through `odata_write` and always dry-run first unless you explicitly enable `writable: true` and pass `dryRun: false`. No spreadsheet exports, no hand-written OData URLs — ask in natural language, get structured data from catalogs and documents. Tool messages (errors, hints, warnings) are returned in Bulgarian.

```bash
npx -y onec-odata-mcp
```

Configure via `ONEC_BASE_URL` / `ONEC_USERNAME` / `ONEC_PASSWORD` env vars (see the quick-start above for `claude mcp add` and `claude_desktop_config.json` snippets — the JSON is language-agnostic). Optional: `ONEC_WRITABLE=true` to allow real writes. Published on npm as [`onec-odata-mcp`](https://www.npmjs.com/package/onec-odata-mcp) and listed in the official MCP Registry as `io.github.alexgrebeshok-coder/onec-odata-mcp`.
