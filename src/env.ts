import { defineEnvVars } from '@sveltejs/kit/env';
import type { DatabaseModeConfig } from './lib/server/db/dialect';

const databaseModes: DatabaseModeConfig[] = [
	'RUNTIME_SQLITE',
	'NODE_SQLITE',
	'BETTER_SQLITE3',
	'LIBSQL',
	'BUN_SQL',
	'CLOUDFLARE',
	'NODE_POSTGRES',
	'POSTGRES_JS',
	'NEON'
];

export const variables = defineEnvVars({
	DATABASE_MODE: {
		description:
			'Selects both the SQL dialect and the driver used to connect to the database. Defaults to RUNTIME_SQLITE, which picks NODE_SQLITE or BUN_SQL based on the JS runtime actually running the process.',
		schema: (value): DatabaseModeConfig => {
			const mode = value ?? 'RUNTIME_SQLITE';
			if (!databaseModes.includes(mode as DatabaseModeConfig)) {
				throw new Error(`DATABASE_MODE must be one of ${databaseModes.join(', ')}, got "${value}"`);
			}
			return mode as DatabaseModeConfig;
		}
	},
	DATABASE_URL: {
		description:
			'Connection string or file path for the database; meaning depends on DATABASE_MODE. Unused when DATABASE_MODE=CLOUDFLARE.'
	},
	CLOUDFLARE_ACCOUNT_ID: {
		description: 'Cloudflare account ID, required when DATABASE_MODE=CLOUDFLARE.'
	},
	CLOUDFLARE_API_TOKEN: {
		description:
			'Cloudflare API token, required when DATABASE_MODE=CLOUDFLARE. Also used by other Cloudflare integrations.'
	},
	CLOUDFLARE_DATABASE_ID: {
		description: 'Cloudflare D1 database ID, required when DATABASE_MODE=CLOUDFLARE.'
	}
});
