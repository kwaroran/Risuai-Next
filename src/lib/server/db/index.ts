import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';
import {
	DATABASE_MODE,
	DATABASE_URL,
	CLOUDFLARE_API_TOKEN,
	CLOUDFLARE_DATABASE_ID,
	CLOUDFLARE_ACCOUNT_ID
} from '$app/env/private';

type Dbtype =
	| SqliteRemoteDatabase<typeof schema>
	| BetterSQLite3Database<typeof schema>
	| DrizzleD1Database<typeof schema>
	| BunSQLDatabase<typeof schema>;

let realDb: Dbtype;

export const getDb = async (cenv?: any | undefined | null): Promise<Dbtype> => {
	if (realDb) {
		return realDb;
	}

	switch (DATABASE_MODE) {
		case 'NODE_SQLITE': {
			//@ts-ignore Might throw errors on non-node env or old versions of node
			const { drizzle } = await import('drizzle-orm/node-sqlite');
			return drizzle(DATABASE_URL || 'risuainext.db');
		}
		case 'BETTER_SQLITE3': {
			const { drizzle } = await import('drizzle-orm/better-sqlite3');
			return drizzle(DATABASE_URL);
		}
		case 'LIBSQL': {
			const { drizzle } = await import('drizzle-orm/libsql');
			return drizzle(DATABASE_URL);
		}
		case 'BUN_SQL': {
			//@ts-ignore Might throw errors on non-bun env or old versions of bun
			const { drizzle } = await import('drizzle-orm/bun-sql');
			//@ts-ignore Might throw errors on non-bun env or old versions of bun
			const { Database } = await import('bun:sqlite');
			const sqlite = new Database(DATABASE_URL || 'sqlite.db');
			return drizzle({ client: sqlite });
		}
		case 'CLOUDFLARE': {
			if (cenv?.D1Database) {
				const { drizzle } = await import('drizzle-orm/d1');
				realDb = drizzle(cenv.D1Database, { schema });
			} else {
				const { drizzle } = await import('drizzle-orm/sqlite-proxy');
				realDb = drizzle(
					async (sql, params, method) => {
						const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID!}/d1/database/${
							CLOUDFLARE_DATABASE_ID
						}/query`;

						const res = await fetch(url, {
							method: 'POST',
							headers: {
								Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
								'Content-Type': 'application/json'
							},
							body: JSON.stringify({ sql, params, method })
						});

						const data = await res.json();

						if (res.status !== 200)
							throw new Error(
								`Error from sqlite proxy server: ${res.status} ${res.statusText}\n${JSON.stringify(data)}`
							);
						if (data.errors.length > 0 || !data.success)
							throw new Error(`Error from sqlite proxy server: \n${JSON.stringify(data)}}`);

						const qResult = data.result[0];

						if (!qResult.success)
							throw new Error(`Error from sqlite proxy server: \n${JSON.stringify(data)}`);

						return { rows: qResult.results.map((r: any) => Object.values(r)) };
					},
					{ schema }
				);
			}

			return realDb;
		}
	}

	throw new Error(`Unknown DATABASE_MODE ${DATABASE_MODE}`);
};
