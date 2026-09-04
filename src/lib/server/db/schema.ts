import { sql } from 'drizzle-orm';
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
	linkedPrompt: text('linkedPrompt').notNull(),

	//last accessed
	lastAccessedAt: text('created_at').notNull(),
	
	//creation time
	createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),

	//toggles data
	toggles: text('toggles', {mode: 'json'}).notNull()
});

export const messages = sqliteTable('messages', {
	//id
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),

	//session
	chatSessionId: text('chatSessionId').notNull(),

	//speaker, also known as senders module ID
	speakerId: text('speakerId').notNull(),

	//message content
	message: text('message').notNull(),

	//metadata
	meta: text('meta', {mode: 'json'}).notNull(),

	//owner user with read/write permission
	//thou we can check the chatSessions, its here to reduce unnecessary sql calls
	owner: text('owner').notNull(),

	//creation time
	createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),

	//position in the session, fractional indexing
	position: text('position').notNull()
})

export const modules = sqliteTable('modules', {
	//id
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),

	//icon, image id is stored
	icon: text('icon').notNull(),

	//owner user
	owner: text('owner').notNull(),
})

export const regexscripts = sqliteTable('regexscripts', {
	//id
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),

	//parent module's id
	moduleId: text('moduleId').notNull(),

	//expression of the regex, except the flag
	regexExpression: text('regexExpression').notNull(),

	//flag of the regex
	regexFlag: text('regexFlag').notNull(),

	//replacer
	content: text('content').notNull()
})