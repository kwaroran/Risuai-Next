# Database (`src/lib/server/db/`)

Drizzle ORM, with a single schema that works against both SQLite and Postgres. Which one is
actually used is chosen at runtime/deploy-time via `DATABASE_MODE` — there's no per-dialect
branching in application code, callers just do `const db = await getDb(); db.select()...` /
`db.query.<table>...` the same way regardless.

## Files

- `src/lib/server/db/dialect.ts` — resolves `DATABASE_MODE` into a concrete `DatabaseMode` and
  derives whether the active dialect is `'pg'` or `'sqlite'` (`isPg`). This is the single source
  of truth other files build on. Reads `process.env.DATABASE_MODE` directly (not
  `$app/env/private`) because `schema.ts` is also loaded by `drizzle-kit` outside of a SvelteKit
  request context.
- `src/lib/server/db/columns.ts` — dialect-agnostic column/table helpers (see below) that
  `schema.ts` is built from.
- `src/lib/server/db/schema.ts` — the actual tables (`accounts`, `files`, `chatSessions`,
  `messages`, `messageSessions`, `modules`, `regexscripts`). Written once, using
  the helpers from `columns.ts` — never imports `drizzle-orm/pg-core` or `drizzle-orm/sqlite-core`
  directly.
- `src/lib/message.ts` — `MessageVariant` / `MessageContentBlock`, the shapes stored in
  `messages.variants` (see below). Lives outside `server/` (isomorphic, no server-only imports) since the chat UI needs the
  same type to render messages.
- `src/lib/server/db/index.ts` — `getDb(cenv?)`, which lazily connects using whichever driver
  `DATABASE_MODE` resolved to and caches the connection in module state (`realDb`). `cenv` is only
  used for `CLOUDFLARE` mode, to pass through the Cloudflare Workers `env` binding when available
  (see below). Exports `Db`, the type `getDb()` resolves to — see "Why `Db` is a borrowed type"
  below.
- `src/lib/server/db/queries/` — hand-written query functions (reads and writes both), one file
  per domain (e.g. `queries/messages.ts`), mirroring the table groupings in `schema.ts`.
  Deliberately not a single `queries.ts` — that grows unbounded as more query functions get added.
  Functions here take `(...args, owner, options?: { ..., cenv? })` and call `getDb(cenv)`
  themselves, same pattern as `getDb`. `queries/messages.ts` has the full read/write lifecycle for
  the message tables: `getRecentMessages`, `createMessage`, `editMessageContent`,
  `regenerateMessage`, `switchMessageVariant`, `forkChatSession` — each takes the caller's
  `owner` and checks it against `messages.owner`/`chatSessions.owner` as part of its query (never
  a separate round trip), and throws if the row doesn't exist or doesn't belong to that owner.
- `src/lib/server/db/position.ts` — thin wrapper around the `fractional-indexing` npm package
  (not hand-rolled: the base-N key generation is easy to get subtly wrong, e.g. running out of
  precision under repeated inserts at the same spot). Every `position` column in `schema.ts`
  (`messageSessions`, `regexscripts`) is one of these keys. `nextPosition(lastPosition)` covers
  the common "append after everything" case; import `generateKeyBetween` directly for inserting
  between two existing positions.

### Why `Db` is a borrowed type

`getDb()`'s real return type is a union of every driver's Database type (`Dbtype` in
`index.ts`) — one member per `DATABASE_MODE` branch. That union is too wide for TypeScript to
resolve chained builder calls against (`.select().from()...` becomes "not callable" - none of the
drivers' overloaded signatures merge cleanly across that many members). So `getDb()` is typed to
return `Db`, a single borrowed driver type (`BetterSQLite3Database<typeof schema>`, arbitrarily -
same "pick one dialect's type as the canonical face" trick `columns.ts` uses for columns), with
`as unknown as Db` casts at each real return point. The actual runtime object is still whatever
driver `DATABASE_MODE` picked; only its compile-time type is narrowed. This is safe for the
core query-builder surface every driver actually shares (`select`/`insert`/`update`/`delete`/
`query`/`transaction`) - which is all `queries/` functions should use. If you ever need a
driver-specific feature not on that shared surface, that's a sign it doesn't belong behind this
dialect-agnostic layer.

## `DATABASE_MODE`

One env var picks both the SQL dialect and the driver. Valid values (see `DatabaseMode` /
`DatabaseModeConfig` in `dialect.ts`):

| Mode                       | Dialect | Driver                                                                                                                                 |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNTIME_SQLITE` (default) | sqlite  | resolves to `NODE_SQLITE` or `BUN_SQL` based on `typeof Bun !== 'undefined'` — never a real value by the time it reaches `db/index.ts` |
| `NODE_SQLITE`              | sqlite  | `drizzle-orm/node-sqlite` (Node's built-in `node:sqlite`)                                                                              |
| `BETTER_SQLITE3`           | sqlite  | `drizzle-orm/better-sqlite3`                                                                                                           |
| `LIBSQL`                   | sqlite  | `drizzle-orm/libsql`                                                                                                                   |
| `BUN_SQL`                  | sqlite  | `drizzle-orm/bun-sql` + `bun:sqlite`                                                                                                   |
| `CLOUDFLARE`               | sqlite  | D1 — direct binding if `cenv.D1Database` is passed in, otherwise the D1 HTTP REST API via `drizzle-orm/sqlite-proxy`                   |
| `NODE_POSTGRES`            | pg      | `drizzle-orm/node-postgres` (`pg`)                                                                                                     |
| `POSTGRES_JS`              | pg      | `drizzle-orm/postgres-js`                                                                                                              |
| `NEON`                     | pg      | `drizzle-orm/neon-http` (`@neondatabase/serverless`)                                                                                   |

`DATABASE_URL` is the connection string/file path for every mode except `CLOUDFLARE`, which
instead uses `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_DATABASE_ID` / `CLOUDFLARE_API_TOKEN`. All of
these are declared with descriptions in `src/env.ts`. `drizzle.config.ts` (used by
`pnpm db:generate` / `db:push` / `db:studio`) reads the exact same `databaseMode`/`isPg` from
`dialect.ts`, so migrations are always generated against whatever dialect the app is actually
configured for.

**Adding a driver**: add the mode to `DatabaseMode` in `dialect.ts` (and to `pgModes` there if
it's Postgres), add a `case` in the `db/index.ts` switch, and if it needs a new npm package,
install it and dynamic-`import()` it inside that case (like the existing branches) rather than a
top-level import, so unrelated deploys don't pay for drivers they don't use.

## `columns.ts` — how dialect-agnostic columns work

Drizzle has no single column-builder API shared between `pg-core` and `sqlite-core` — `pgTable`
and `sqliteTable` return structurally different builder classes. `columns.ts` papers over this
with small helpers (`id`, `text`, `int`, `boolean`, `json<T>`, `timestamp`, plus `table`/`index`)
that branch on `isPg` at module-load time to construct the real Postgres or SQLite column, but are
**typed** as whatever the SQLite version would return (via `as unknown as ReturnType<typeof
sqliteVersion>`). The Postgres branch is a real pg column at runtime — only its compile-time type
is borrowed — which is what lets `schema.ts` chain `.notNull()`, `.default()`, `.references()`,
etc. normally and get autocomplete, without `schema.ts` ever needing to know which dialect is
active.

Practical effect of each helper's dialect mapping:

- `id()` — UUID text primary key (`crypto.randomUUID()` via `$defaultFn`) on both.
- `boolean()` — `integer(mode: 'boolean')` (0/1) on sqlite, native `boolean` on pg.
- `json<T>()` — `text(mode: 'json')` on sqlite, native `jsonb` on pg. Always round-trips as `T` in
  application code.
- `timestamp()` — `integer(mode: 'timestamp')` (unix epoch) on sqlite, native `timestamp` on pg.
  Always surfaces as a JS `Date`. Deliberately has **no DB-level default** — set defaults with
  `.$defaultFn(() => new Date())` in `schema.ts` instead of SQL (`CURRENT_TIMESTAMP`/`now()`), so
  the actual default value is computed identically regardless of dialect.

**Adding a column type**: follow the same pattern — a private `xBase(name)` function using the
sqlite builder (this is what gives the exported helper its borrowed type), then the exported
function branches on `isPg` and casts the pg branch to `ReturnType<typeof xBase>`.

`columns.ts` also exports `AnyColumn`, a type-only escape hatch for circular `.references()`
thunks — for anywhere two tables' columns reference each other (or a table references itself),
which would otherwise make the inferred types collapse to `any`. Nothing in the current schema
needs it.

## Schema (`schema.ts`)

- `accounts` — one row per user. `accountType` is a small numeric enum (see comments in
  `schema.ts` for the current meanings) rather than a real enum column, since those differ across
  dialects too.
- `files` — owned by an `accounts` row. Metadata only (`filename`, `mimeType`, `size`,
  `storageKey`) — `storageKey` is an opaque pointer into wherever the actual bytes live (local
  path, S3/R2 key, etc.); this schema doesn't care which. Referenced by id from `file` content
  blocks (see `MessageContentBlock` below) — not a DB-level foreign key from there, since that
  reference lives inside a JSON column.
- `chatSessions` — owned by an `accounts` row (`onDelete: 'cascade'`). `enabledModules`/`chatVars`
  are JSON arrays, `toggles` is a JSON string→boolean map.
- `messages` — one row per turn. `variants` is a JSON `MessageVariant[]` (`src/lib/message.ts`)
  holding every generation of the message — the first generation and every "swipe"/regenerate
  afterwards each append one entry — and `activeVariant` is the index of the one currently shown.
  Append-only, so array order is also generation order. Each variant has its own `content`
  (ordered `MessageContentBlock[]`), `model` (null for human-authored; kept per-variant rather
  than trusted from `chatSessions.linkedModel`, since swipes can each use a different model and
  some `ThoughtBlock` fields are only valid replayed to the exact model that produced them), and
  `createdAt`/`updatedAt` as epoch milliseconds (JSON can't hold a `Date`). Writes to `variants`
  are read-modify-write of the whole array: patching one element in place needs dialect-specific
  JSON functions (`json_set` vs `jsonb_set`) that don't belong behind the borrowed `Db` type.
  Holds no session reference — which session(s) it appears in, and where, lives in
  `messageSessions` instead (see below).
- `messageSessions` — junction table between `messages` and `chatSessions`: `(messageId,
chatSessionId, position)`, one row per (message, session) pair. **This is what makes branching
  possible without copying message content or walking a tree at read time**: a branch is a new
  `chatSessions` row plus a single `INSERT ... SELECT` that copies the shared prefix's
  `(messageId, position)` rows into the new session id — no `messages` row is
  ever duplicated, and "get session X's messages in order" stays one indexed query
  (`messageSessions_chatSessionId_position_idx`) instead of a per-branch content copy or a
  parent-pointer walk. `position` is fractional-indexing and is deliberately a property of the
  membership row, not of `messages` itself, since branching can put the same message into more
  than one session (each with its own place in that session's order — in practice the same
  relative order, since it's a shared prefix). This design replaced an earlier `messages.parentId`
  self-reference / `chatSessions.currentLeafId` "message tree" approach: that made reads a walk
  (no single indexed query, since a session's active path wasn't stored anywhere directly), and a
  same-session-only, deep-copy-per-branch alternative was rejected outright for reintroducing the
  original RisuAI's swipe-array-bloat problem at session-history scale instead of per-message
  scale.
- `modules` — owned by an `accounts` row; `icon` stores an image id, not the image itself (could
  migrate to referencing `files` later, but isn't wired up as a foreign key today).
- `regexscripts` — belongs to a `modules` row. `targetType` is a small numeric enum (see comments
  in `schema.ts`).

## `MessageContentBlock` (`src/lib/message.ts`)

Discriminated union on `type`, stored as the JSON array `MessageVariant.content`
(inside `messages.variants`):

- `text` — `{ type: 'text'; text }`.
- `thought` — `{ type: 'thought'; text?; summary?; ref?; hash?; redacted? }`. Providers don't agree
  on what they expose for reasoning: `text` (full chain of thought), `summary` (condensed - some
  providers, e.g. OpenAI's reasoning models, only ever give this), `ref` (opaque id to reference
  this reasoning item in a later call), and `hash` (opaque signature that must be replayed back
  byte-for-byte to prove the block wasn't tampered with, e.g. Anthropic's thinking signature) are
  all optional and independent. `redacted` is true when the reasoning content itself was withheld
  (e.g. Anthropic's redacted thinking blocks).
- `toolCall` — `{ type: 'toolCall'; id; name; args }`. `id` is matched against a later
  `toolResult.toolCallId` — possibly on a different message, since a call and its result can land
  on separate turns.
- `toolResult` — `{ type: 'toolResult'; toolCallId; result; isError? }`.
- `file` — `{ type: 'file'; fileId; name?; mimeType? }`. `fileId` references `files.id`.

**Adding a block type**: add the interface and union member in `message.ts`. No schema migration
needed — `content` is a single JSON column, so new block shapes don't require a DB change, only
consumers (evaluator/renderer) that need to understand them.

## Known gaps / next steps

- `CLOUDFLARE` mode's D1 HTTP REST fallback (used when no `cenv.D1Database` binding is available)
  hasn't been exercised against a real Cloudflare account yet.
- No migrations are checked into the repo yet (`drizzle/` is untracked/empty) — run
  `pnpm db:generate` before the first `db:push` once real tables are needed somewhere.
- `createMessage`/`regenerateMessage`/`forkChatSession` in `queries/messages.ts` cover the
  multi-step writes described in the schema comments (message with first variant + placement;
  append variant + repoint `activeVariant`; copy shared-prefix placements into a new session).
- Swipe count per message is unbounded — every regenerate grows `messages.variants`, and every
  variant write rewrites the whole array. The original RisuAI hit exactly this (huge per-message
  swipe arrays); if it shows up here, add an app-enforced cap in `regenerateMessage` (drop oldest,
  adjusting `activeVariant`).
- Variant edits are read-modify-write without a transaction, so two concurrent writes to the same
  message (e.g. edit + regenerate) can lose one of them.
- `forkChatSession` doesn't record _that_ a fork happened, only performs it — there's no
  `chatSessions.forkedFromMessageId` (or similar) pointer yet, so "list the sibling branches
  forked from this point" isn't queryable; forked sessions are indistinguishable from independent
  ones that happen to share history. Add that column if branches need to be
  discoverable/navigable as siblings, not just independently browsable sessions.
- No file-upload/storage layer exists yet — the `files` table only models metadata; nothing writes
  to it or interprets `storageKey` yet.
