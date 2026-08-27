import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: {},
	DATABASE_MODE: {},
	CLOUDFLARE_ACCOUNT_ID: {},
	CLOUDFLARE_API_TOKEN: {},
	CLOUDFLARE_DATABASE_ID: {}
});
