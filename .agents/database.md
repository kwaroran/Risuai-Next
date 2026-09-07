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
- `src/lib/server/db/schema.ts` — the actual tables (`accounts`, `chatSessions`, `messages`,
  `modules`, `regexscripts`). Written once, using the helpers from `columns.ts` — never imports
  `drizzle-orm/pg-core` or `drizzle-orm/sqlite-core` directly.
- `src/lib/server/db/index.ts` — `getDb(cenv?)`, which lazily connects using whichever driver
  `DATABASE_MODE` resolved to and caches the connection in module state (`realDb`). `cenv` is only
  used for `CLOUDFLARE` mode, to pass through the Cloudflare Workers `env` binding when available
  (see below).

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

## Schema (`schema.ts`)

- `accounts` — one row per user. `accountType` is a small numeric enum (see comments in
  `schema.ts` for the current meanings) rather than a real enum column, since those differ across
  dialects too.
- `chatSessions` — owned by an `accounts` row (`onDelete: 'cascade'`). `enabledModules`/`chatVars`
  are JSON arrays, `toggles` is a JSON string→boolean map.
- `messages` — belongs to a `chatSessions` row. `swipes` holds alternate generations for the turn
  _excluding_ the currently active `message`. `position` is a fractional-indexing string (not an
  integer ordinal) so messages can be reordered/inserted without renumbering siblings — same
  pattern used by `regexscripts.position`.
- `modules` — owned by an `accounts` row; `icon` stores an image id, not the image itself.
- `regexscripts` — belongs to a `modules` row. `targetType` is a small numeric enum (see comments
  in `schema.ts`).

## Known gaps / next steps

- No repository/query-helper layer on top of `getDb()` — callers use Drizzle's own
  `.select()/.insert()/.update()/.delete()` and `db.query.*` directly. This was a deliberate
  choice since Drizzle's query builder already reads almost identically across sqlite/pg; add one
  only if real cross-dialect friction shows up in practice (e.g. `onConflictDoUpdate` syntax
  differences).
- `CLOUDFLARE` mode's D1 HTTP REST fallback (used when no `cenv.D1Database` binding is available)
  hasn't been exercised against a real Cloudflare account yet.
- No migrations are checked into the repo yet (`drizzle/` is untracked/empty) — run
  `pnpm db:generate` before the first `db:push` once real tables are needed somewhere.
