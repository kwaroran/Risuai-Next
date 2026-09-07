import { defineConfig } from 'drizzle-kit';
import { databaseMode, isPg } from './src/lib/server/db/dialect';

//Same DATABASE_MODE the app reads (see src/lib/server/db/dialect.ts) picks the drizzle-kit
//dialect/driver too, so `pnpm db:push`/`db:generate` always target whatever the app is
//actually configured to talk to.
const config = isPg
	? (() => {
			if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
			return defineConfig({
				schema: './src/lib/server/db/schema.ts',
				dialect: 'postgresql',
				dbCredentials: { url: process.env.DATABASE_URL }
			});
		})()
	: databaseMode === 'CLOUDFLARE'
		? (() => {
				if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('CLOUDFLARE_ACCOUNT_ID is not set');
				if (!process.env.CLOUDFLARE_DATABASE_ID)
					throw new Error('CLOUDFLARE_DATABASE_ID is not set');
				if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is not set');
				return defineConfig({
					schema: './src/lib/server/db/schema.ts',
					dialect: 'sqlite',
					driver: 'd1-http',
					dbCredentials: {
						accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
						databaseId: process.env.CLOUDFLARE_DATABASE_ID,
						token: process.env.CLOUDFLARE_API_TOKEN
					}
				});
			})()
		: defineConfig({
				schema: './src/lib/server/db/schema.ts',
				dialect: 'sqlite',
				dbCredentials: { url: process.env.DATABASE_URL || 'risuainext.db' }
			});

export default { ...config, verbose: true, strict: true };
