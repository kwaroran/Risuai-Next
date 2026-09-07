//Relative import (not the `$lib` alias) - schema.ts is also loaded directly by drizzle-kit,
//which doesn't resolve SvelteKit's path aliases.
import type { MessageContentBlock } from '../../message';
import { id, text, int, boolean, json, timestamp, table, index, type AnyColumn } from './columns';

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

		//session
		chatSessionId: text('chatSessionId')
			.notNull()
			.references(() => chatSessions.id, { onDelete: 'cascade' }),

		//speaker, also known as senders module ID. null means the message was sent by the account owner (the human user), not a module
		speakerId: text('speakerId').references(() => modules.id, { onDelete: 'set null' }),

		//the currently active generation for this turn. Every generation (including the first, and
		//every "swipe"/regenerate afterwards) is its own row in messageVariants - this just points
		//at whichever one is currently shown. Null only for the brief window between creating the
		//message row and creating its first variant; set once and required from then on
		activeVariantId: text('activeVariantId').references((): AnyColumn => messageVariants.id, {
			onDelete: 'set null'
		}),

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

		//position in the session, fractional indexing
		position: text('position').notNull()
	},
	(table) => [
		index('messages_chatSessionId_position_idx').on(table.chatSessionId, table.position),
		index('messages_owner_idx').on(table.owner)
	]
);

export const messageVariants = table(
	'messageVariants',
	{
		//id
		id: id(),

		//parent message (turn) this is a generation of
		messageId: text('messageId')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),

		//ordered content blocks for this generation - plain text, model reasoning ("thoughts"),
		//agentic tool calls/results, and embedded files all interleave in one array. See
		//MessageContentBlock in src/lib/message.ts. Deliberately NOT stored on `messages` itself:
		//every swipe/regenerate creates a new row here instead of growing an array on the message,
		//since unbounded per-message swipe arrays were a real problem in the original RisuAI
		content: json<MessageContentBlock[]>('content').notNull().default([]),

		//which model generated this variant. Null for a human-authored variant (this message's
		//speakerId is null). Recorded per-variant rather than trusting chatSessions.linkedModel,
		//since swipes/regenerates can each use a different model - and since some
		//MessageContentBlock fields (ThoughtBlock's `ref`/`hash`) are only valid replayed back to
		//the exact model/provider that produced them, so callers need to know that before reusing
		//them in a later request
		model: text('model'),

		//creation time - also the natural ordering for "which swipe came after which", since
		//variants are only ever appended, never reordered
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),

		//last edited time, null if never edited since creation (a user can edit a swipe's content
		//after the fact, same as the old single-message edit)
		updatedAt: timestamp('updatedAt')
	},
	(table) => [index('messageVariants_messageId_idx').on(table.messageId, table.createdAt)]
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
