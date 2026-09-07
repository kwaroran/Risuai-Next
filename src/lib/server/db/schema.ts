import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

export const chatSessions = sqliteTable(
	'chatSessions',
	{
		//id used in everywhere
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		//display title, shown in the session list. null until set (e.g. derived from the first message)
		title: text('title'),

		//id of enabled modules
		enabledModules: text('enabledModules', { mode: 'json' })
			.$type<string[]>()
			.notNull()
			.default([]),

		//chat vars
		chatVars: text('chatVars', { mode: 'json' }).$type<string[]>().notNull().default([]),

		//owner user
		owner: text('owner')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),

		//linked model
		linkedModel: text('linkedModel').notNull(),

		//linked prompt
		linkedPrompt: text('linkedPrompt').notNull(),

		//last accessed
		lastAccessedAt: text('lastAccessedAt')
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),

		//creation time
		createdAt: text('created_at')
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),

		//toggles data
		toggles: text('toggles', { mode: 'json' })
			.$type<Record<string, boolean>>()
			.notNull()
			.default({})
	},
	(table) => [index('chatSessions_owner_idx').on(table.owner)]
);

export const messages = sqliteTable(
	'messages',
	{
		//id
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		//session
		chatSessionId: text('chatSessionId')
			.notNull()
			.references(() => chatSessions.id, { onDelete: 'cascade' }),

		//speaker, also known as senders module ID. null means the message was sent by the account owner (the human user), not a module
		speakerId: text('speakerId').references(() => modules.id, { onDelete: 'set null' }),

		//active message content
		message: text('message').notNull(),

		//alternate generations for this turn (swipes), not including the currently active `message`
		swipes: text('swipes', { mode: 'json' }).$type<string[]>().notNull().default([]),

		//metadata
		meta: text('meta', { mode: 'json' }).notNull(),

		//owner user with read/write permission
		//thou we can check the chatSessions, its here to reduce unnecessary sql calls
		owner: text('owner')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),

		//creation time
		createdAt: text('created_at')
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),

		//last edited time, null if never edited since creation
		updatedAt: text('updatedAt'),

		//position in the session, fractional indexing
		position: text('position').notNull()
	},
	(table) => [
		index('messages_chatSessionId_position_idx').on(table.chatSessionId, table.position),
		index('messages_owner_idx').on(table.owner)
	]
);

export const modules = sqliteTable(
	'modules',
	{
		//id
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		//display name
		name: text('name').notNull(),

		//icon, image id is stored
		icon: text('icon').notNull(),

		//owner user
		owner: text('owner')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' })
	},
	(table) => [index('modules_owner_idx').on(table.owner)]
);

export const regexscripts = sqliteTable(
	'regexscripts',
	{
		//id
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		//parent module's id
		moduleId: text('moduleId')
			.notNull()
			.references(() => modules.id, { onDelete: 'cascade' }),

		//whether this script is applied
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

		//order of application within the module, fractional indexing
		position: text('position').notNull(),

		//targetType
		//0 - user input
		//1 - AI output
		//2 - display only (does not affect stored content)
		targetType: integer('targetType').notNull(),

		//expression of the regex, except the flag
		regexExpression: text('regexExpression').notNull(),

		//flag of the regex
		regexFlag: text('regexFlag').notNull(),

		//replacer
		content: text('content').notNull()
	},
	(table) => [index('regexscripts_moduleId_position_idx').on(table.moduleId, table.position)]
);
