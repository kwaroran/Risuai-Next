//Relative import (not the `$lib` alias) - schema.ts is also loaded directly by drizzle-kit,
//which doesn't resolve SvelteKit's path aliases.
import type { MessageRole, MessageVariant } from '../../message';
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

export const files = table(
	'files',
	{
		//id, referenced from message content blocks (see MessageContentBlock's `fileId`) - not a
		//DB-level foreign key there since it's nested inside a JSON column
		id: id(),

		//owner user
		owner: text('owner')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),

		//original filename, as uploaded
		filename: text('filename').notNull(),

		//MIME type, as uploaded/detected
		mimeType: text('mimeType').notNull(),

		//size in bytes
		size: int('size').notNull(),

		//opaque pointer into wherever the actual bytes live (local path, S3/R2 key, etc.) -
		//interpretation is up to the storage layer, not this schema
		storageKey: text('storageKey').notNull(),

		//creation time
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [index('files_owner_idx').on(table.owner)]
);

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

		//role, see MessageRole in src/lib/message.ts
		//0 - user
		//1 - assistant
		//2 - system
		//Who spoke is speakerId below, not this - the two are independent
		role: int('role').$type<MessageRole>().notNull(),

		//speaker, also known as senders module ID. null means the account owner (the human user),
		//or a module that has since been deleted - don't derive the role from this, use `role`
		speakerId: text('speakerId').references(() => modules.id, { onDelete: 'set null' }),

		//every generation of this message - the first generation and every "swipe"/regenerate
		//afterwards each append one entry. See MessageVariant in src/lib/message.ts. Append-only,
		//never reordered, so array order is also "which swipe came after which"
		variants: json<MessageVariant[]>('variants').notNull().default([]),

		//index into `variants` of the generation currently shown
		activeVariant: int('activeVariant').notNull().default(0),

		//metadata
		meta: json<unknown>('meta').notNull(),

		//owner user with read/write permission
		//though we can check via messageSessions -> chatSessions, that's two joins just to
		//authorize a read/write - it's here to keep that a single-column check
		owner: text('owner')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),

		//creation time
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date())

		//no chatSessionId/position here - which session(s) a message belongs to, and where, is
		//tracked in messageSessions instead, since a message can be shared by multiple sessions
		//(see messageSessions below for why)
	},
	(table) => [index('messages_owner_idx').on(table.owner)]
);

export const messageSessions = table(
	'messageSessions',
	{
		//id
		id: id(),

		//which message this is
		messageId: text('messageId')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),

		//which session it appears in
		chatSessionId: text('chatSessionId')
			.notNull()
			.references(() => chatSessions.id, { onDelete: 'cascade' }),

		//this message's order within `chatSessionId`, fractional indexing. Ordering is a property
		//of session membership, not of the message itself, since branching can put the same
		//message into more than one session
		position: text('position').notNull()

		//Branching a session from an earlier point does NOT copy any messages -
		//it copies (messageId, position) pairs into a new chatSessionId here (select the source
		//rows up to the fork point, then bulk-insert them under the new session id - not a single
		//`INSERT ... SELECT`, since `id()`'s default is generated client-side per row, not a SQL
		//DEFAULT). This is what makes forking cheap: shared history is referenced, never
		//duplicated, and only new messages created after the fork ever get new rows anywhere.
		//Deliberately not modeled as messages.chatSessionId + messages.position (a single column
		//each) the way a flat, non-branching design would: a message can then only ever belong to
		//one session, so branching would have to either copy full message rows (unbounded storage
		//growth - the same class of problem as the original RisuAI's swipe-array bloat, just at
		//session-history scale) or walk parent pointers at read time (which doesn't index well and
		//costs a query per hop). A junction table keeps `messages` shared across branches and
		//lets "which messages are in this session, in what order" stay a single indexed query.
	},
	(table) => [
		index('messageSessions_chatSessionId_position_idx').on(table.chatSessionId, table.position),
		index('messageSessions_messageId_idx').on(table.messageId)
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
