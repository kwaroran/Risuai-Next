import { and, desc, eq, lt, lte } from 'drizzle-orm';
import type { MessageContentBlock, MessageRole, MessageVariant } from '../../../message';
import { getDb, type Db } from '../index';
import { chatSessions, messageSessions, messages } from '../schema';
import { nextPosition } from '../position';

//Returns up to `limit` messages in a chat session, oldest first, for pages before `before` (or
//the most recent page, if `before` is omitted). `before` is a message id, exclusive (the caller
//already has that message from an earlier page).
//
//Which messages belong to a session, and in what order, lives in messageSessions - not on
//`messages` itself, since branching can put the same message into more than one session (see
//messageSessions in schema.ts). That means this is one real query: join messageSessions to
//messages, filter by session + owner, order by position, limit. No tree walk, no per-branch
//content copy - `owner` rides along in the same WHERE clause, so the ownership check costs
//nothing extra, and `before`'s position is resolved with a scalar subquery rather than a
//separate round trip. Each message carries all of its variants; the shown one is
//`message.variants[message.activeVariant]`.
export async function getRecentMessages(
	chatSessionId: string,
	owner: string,
	options: { limit?: number; before?: string; cenv?: any } = {}
) {
	const { limit = 10, before, cenv } = options;
	const db = await getDb(cenv);

	const beforePosition = before
		? db
				.select({ position: messageSessions.position })
				.from(messageSessions)
				.where(
					and(
						eq(messageSessions.messageId, before),
						eq(messageSessions.chatSessionId, chatSessionId)
					)
				)
		: null;

	const rows = await db
		.select({ message: messages, position: messageSessions.position })
		.from(chatSessions)
		.innerJoin(messageSessions, eq(messageSessions.chatSessionId, chatSessions.id))
		.innerJoin(messages, eq(messages.id, messageSessions.messageId))
		.where(
			and(
				eq(chatSessions.id, chatSessionId),
				eq(chatSessions.owner, owner),
				beforePosition ? lt(messageSessions.position, beforePosition) : undefined
			)
		)
		.orderBy(desc(messageSessions.position))
		.limit(limit);

	return rows.reverse(); //most-recent-first -> chronological order
}

//Appends a new message to the end of a chat session: a `messages` row holding its first variant
//(activeVariant 0), and the `messageSessions` row placing it at the end. createMessage is the
//hottest write path in this schema (called on every turn, unlike e.g. forkChatSession), so it's
//worth keeping to the minimum number of round trips: 1 (ownership + last position) + 1 (insert
//message) + 1 (insert placement) = 3.
export async function createMessage(
	chatSessionId: string,
	owner: string,
	params: {
		role: MessageRole;
		speakerId?: string | null;
		content: MessageContentBlock[];
		model?: string | null;
		meta?: unknown;
		cenv?: any;
	}
) {
	const db = await getDb(params.cenv);

	//ownership check + "what's the last position in this session" in one query - a session with
	//no messages yet still returns one row (via the LEFT JOIN), with a null position
	const [placement] = await db
		.select({ owner: chatSessions.owner, position: messageSessions.position })
		.from(chatSessions)
		.leftJoin(messageSessions, eq(messageSessions.chatSessionId, chatSessions.id))
		.where(eq(chatSessions.id, chatSessionId))
		.orderBy(desc(messageSessions.position))
		.limit(1);

	if (!placement || placement.owner !== owner) throw new Error('Chat session not found');

	const variant: MessageVariant = {
		content: params.content,
		model: params.model ?? null,
		createdAt: Date.now()
	};

	const [message] = await db
		.insert(messages)
		.values({
			role: params.role,
			speakerId: params.speakerId ?? null,
			variants: [variant],
			activeVariant: 0,
			meta: params.meta ?? null,
			owner
		})
		.returning();

	await db.insert(messageSessions).values({
		messageId: message.id,
		chatSessionId,
		position: nextPosition(placement.position)
	});

	return message;
}

//Reads a message's variants for a read-modify-write, checking ownership in the same query.
//Variants live in one JSON column, and editing a single array element in place needs
//dialect-specific JSON functions (json_set vs jsonb_set) that don't belong behind the borrowed
//`Db` type - so writes to `variants` rewrite the whole array instead.
async function getOwnedVariants(db: Db, messageId: string, owner: string) {
	const [message] = await db
		.select({ variants: messages.variants, activeVariant: messages.activeVariant })
		.from(messages)
		.where(and(eq(messages.id, messageId), eq(messages.owner, owner)));

	if (!message) throw new Error('Message not found');
	return message;
}

//Edits the content of a message's *currently active* generation in place - not a new swipe, just
//a correction to what's already shown. Leaves the other variants (swipes) untouched.
export async function editMessageContent(
	messageId: string,
	owner: string,
	content: MessageContentBlock[],
	options: { cenv?: any } = {}
) {
	const db = await getDb(options.cenv);
	const { variants, activeVariant } = await getOwnedVariants(db, messageId, owner);

	const active = variants[activeVariant];
	if (!active) throw new Error('Message not found');

	const next = variants.slice();
	next[activeVariant] = { ...active, content, updatedAt: Date.now() };

	await db.update(messages).set({ variants: next }).where(eq(messages.id, messageId));
}

//Regenerates a message: appends a new variant (a new swipe) and makes it the active one. The
//previous generation isn't deleted - see switchMessageVariant to swipe back to it.
export async function regenerateMessage(
	messageId: string,
	owner: string,
	params: { content: MessageContentBlock[]; model?: string | null; cenv?: any }
) {
	const db = await getDb(params.cenv);
	const { variants } = await getOwnedVariants(db, messageId, owner);

	const variant: MessageVariant = {
		content: params.content,
		model: params.model ?? null,
		createdAt: Date.now()
	};

	await db
		.update(messages)
		.set({ variants: [...variants, variant], activeVariant: variants.length })
		.where(eq(messages.id, messageId));

	return variant;
}

//Swipes a message to an already-existing generation (from an earlier regenerateMessage call)
//instead of creating a new one. `variantIndex` is an index into `messages.variants`.
export async function switchMessageVariant(
	messageId: string,
	owner: string,
	variantIndex: number,
	options: { cenv?: any } = {}
) {
	const db = await getDb(options.cenv);
	const { variants } = await getOwnedVariants(db, messageId, owner);

	if (!Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex >= variants.length) {
		throw new Error('Variant not found');
	}

	await db.update(messages).set({ activeVariant: variantIndex }).where(eq(messages.id, messageId));
}

//Branches a chat session at `forkAtMessageId` (inclusive): creates a new session, and copies the
//shared prefix's (messageId, position) pairs from messageSessions into it. Never touches
//messages - only small placement rows are copied, so this is cheap regardless of
//how much content the shared history holds. See messageSessions in schema.ts for why.
export async function forkChatSession(
	chatSessionId: string,
	owner: string,
	forkAtMessageId: string,
	options: { cenv?: any } = {}
) {
	const db = await getDb(options.cenv);

	const [source] = await db
		.select()
		.from(chatSessions)
		.where(and(eq(chatSessions.id, chatSessionId), eq(chatSessions.owner, owner)));

	if (!source) throw new Error('Chat session not found');

	const [placement] = await db
		.select({ position: messageSessions.position })
		.from(messageSessions)
		.where(
			and(
				eq(messageSessions.chatSessionId, chatSessionId),
				eq(messageSessions.messageId, forkAtMessageId)
			)
		);

	if (!placement) throw new Error('Message not found in this session');

	const [forked] = await db
		.insert(chatSessions)
		.values({
			title: source.title,
			enabledModules: source.enabledModules,
			chatVars: source.chatVars,
			owner,
			linkedModel: source.linkedModel,
			linkedPrompt: source.linkedPrompt,
			toggles: source.toggles
		})
		.returning();

	const sharedPrefix = await db
		.select({ messageId: messageSessions.messageId, position: messageSessions.position })
		.from(messageSessions)
		.where(
			and(
				eq(messageSessions.chatSessionId, chatSessionId),
				lte(messageSessions.position, placement.position)
			)
		);

	if (sharedPrefix.length > 0) {
		await db.insert(messageSessions).values(
			sharedPrefix.map((row) => ({
				messageId: row.messageId,
				chatSessionId: forked.id,
				position: row.position
			}))
		);
	}

	return forked;
}
