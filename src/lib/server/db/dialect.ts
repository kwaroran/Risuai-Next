//DATABASE_MODE selects both the SQL dialect and the driver used to talk to it.
//Schema (schema.ts / columns.ts) only needs to know the dialect, db/index.ts and
//drizzle.config.ts need the fully resolved mode.
//Read directly from process.env here (not $app/env/private) so drizzle-kit, which loads
//schema.ts outside of a SvelteKit request context, resolves the same dialect as the app does.
export type DatabaseMode =
	| 'NODE_SQLITE'
	| 'BETTER_SQLITE3'
	| 'LIBSQL'
	| 'BUN_SQL'
	| 'CLOUDFLARE'
	| 'NODE_POSTGRES'
	| 'POSTGRES_JS'
	| 'NEON';

//RUNTIME_SQLITE isn't a real driver - it resolves to whichever sqlite driver matches the JS
//runtime actually running the process, so the same config works started with either `node` or
//`bun` without the two needing different DATABASE_MODE values.
export type DatabaseModeConfig = DatabaseMode | 'RUNTIME_SQLITE';

export type DatabaseDialect = 'sqlite' | 'pg';

const pgModes = new Set<DatabaseMode>(['NODE_POSTGRES', 'POSTGRES_JS', 'NEON']);

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

function resolveDatabaseMode(mode: DatabaseModeConfig): DatabaseMode {
	return mode === 'RUNTIME_SQLITE' ? (isBunRuntime ? 'BUN_SQL' : 'NODE_SQLITE') : mode;
}

export const databaseMode = resolveDatabaseMode(
	(process.env.DATABASE_MODE as DatabaseModeConfig) || 'RUNTIME_SQLITE'
);

export const dialect: DatabaseDialect = pgModes.has(databaseMode) ? 'pg' : 'sqlite';

export const isPg = dialect === 'pg';
