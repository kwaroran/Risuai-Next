import { id, text, int, boolean, json, timestamp, table, index } from './columns';

export const accounts = table('accounts', {
	//id used in everywhere
	id: id(),

	//accountType
	//0 - Testing Account / Misc
	//1 - Linked with Sionyw
	//2 - Local Hosted-Use
	accountType: int('accountType').notNull(),

	//linkedId
	//Store linked Sionyw DBID
	//Might be used on other accountType future
	linkedId: text('linkedId'),

	//Display name
	name: text('name')
});

export const chatSessions = table(
	'chatSessions',
	{
		//id used in everywhere
		id: id(),

		//display title, shown in the session list. null until set (e.g. derived from the first message)
		title: text('title'),

		//id of enabled modules
		enabledModules: json<string[]>('enabledModules').notNull().default([]),

		//chat vars
		chatVars: json<string[]>('chatVars').notNull().default([]),

		//owner user
		owner: text('owner')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),

		//linked model
		linkedModel: text('linkedModel').notNull(),

		//linked prompt
		linkedPrompt: text('linkedPrompt').notNull(),

		//last accessed
		lastAccessedAt: timestamp('lastAccessedAt')
			.notNull()
			.$defaultFn(() => new Date()),

		//creation time
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),

		//toggles data
		toggles: json<Record<string, boolean>>('toggles').notNull().default({})
	},
	(table) => [index('chatSessions_owner_idx').on(table.owner)]
);

export const messages = table(
	'messages',
	{
		//id
		id: id(),

		//session
		chatSessionId: text('chatSessionId')
			.notNull()
			.references(() => chatSessions.id, { onDelete: 'cascade' }),

		//speaker, also known as senders module ID. null means the message was sent by the account owner (the human user), not a module
		speakerId: text('speakerId').references(() => modules.id, { onDelete: 'set null' }),

		//active message content
		message: text('message').notNull(),

		//alternate generations for this turn (swipes), not including the currently active `message`
		swipes: json<string[]>('swipes').notNull().default([]),

		//metadata
		meta: json<unknown>('meta').notNull(),

		//owner user with read/write permission
		//thou we can check the chatSessions, its here to reduce unnecessary sql calls
		owner: text('owner')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),

		//creation time
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),

		//last edited time, null if never edited since creation
		updatedAt: timestamp('updatedAt'),

		//position in the session, fractional indexing
		position: text('position').notNull()
	},
	(table) => [
		index('messages_chatSessionId_position_idx').on(table.chatSessionId, table.position),
		index('messages_owner_idx').on(table.owner)
	]
);

export const modules = table(
	'modules',
	{
		//id
		id: id(),

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

export const regexscripts = table(
	'regexscripts',
	{
		//id
		id: id(),

		//parent module's id
		moduleId: text('moduleId')
			.notNull()
			.references(() => modules.id, { onDelete: 'cascade' }),

		//whether this script is applied
		enabled: boolean('enabled').notNull().default(true),

		//order of application within the module, fractional indexing
		position: text('position').notNull(),

		//targetType
		//0 - user input
		//1 - AI output
		//2 - display only (does not affect stored content)
		targetType: int('targetType').notNull(),

		//expression of the regex, except the flag
		regexExpression: text('regexExpression').notNull(),

		//flag of the regex
		regexFlag: text('regexFlag').notNull(),

		//replacer
		content: text('content').notNull()
	},
	(table) => [index('regexscripts_moduleId_position_idx').on(table.moduleId, table.position)]
);
