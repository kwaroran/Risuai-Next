import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
	//id used in everywhere
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),

	//accountType
	//0 - Testing Account / Misc
	//1 - Linked with Sionyw
	//2 - Local Hosted-Use
	accountType: integer('accountType').notNull(),

	//linkedId
	//Store linked Sionyw DBID
	//Might be used on other accountType future
	linkedId: text('linkedId'),

	//Display name
	name: text('name')
});

export const chatSessions = sqliteTable('chatSessions', {
	//id used in everywhere
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),

	//id of enabled modules
	enabledModules: text('enabledModules', { mode: 'json' }).$type<string[]>().notNull().default([]),

	//chat vars
	chatVars: text('chatVars', { mode: 'json' }).$type<string[]>().notNull().default([]),

	//owner user
	owner: text('owner').notNull(),

	//linked model
	linkedModel: text('linkedModel').notNull(),

	//linked prompt
	linkedPrompt: text('linkedPrompt').notNull()
});
