import { and, desc, eq, lt, lte, or, sql } from 'drizzle-orm';
import type { MessageContentBlock } from '../../../message';
import { getDb } from '../index';
import { chatSessions, messageSessions, messages, messageVariants } from '../schema';
import { nextPosition } from '../position';

//Returns up to `limit` messages in a chat session, oldest first, for pages before `before` (or
//the most recent page, if `before` is omitted). `before` is a message id, exclusive (the caller
//already has that message from an earlier page).
//
//Which messages belong to a session, and in what order, lives in messageSessions - not on
//`messages` itself, since branching can put the same message into more than one session (see
//messageSessions in schema.ts). That means this is one real query: join messageSessions to
//messages/messageVariants, filter by session + owner, order by position, limit. No tree walk, no
//per-branch content copy - `owner` rides along in the same WHERE clause, so the ownership check
//costs nothing extra, and `before`'s position is resolved with a scalar subquery rather than a
//separate round trip.
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
		.select({ message: messages, variant: messageVariants, position: messageSessions.position })
		.from(chatSessions)
		.innerJoin(messageSessions, eq(messageSessions.chatSessionId, chatSessions.id))
		.innerJoin(messages, eq(messages.id, messageSessions.messageId))
		.leftJoin(
			messageVariants,
			and(eq(messageVariants.messageId, messages.id), eq(messageVariants.active, true))
		)
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

//Appends a new message to the end of a chat session: a `messages` row, its first
//`messageVariants` row (inserted with active=true directly - no follow-up update needed, see
//messages.ts's comment above the (removed) activeVariantId field in schema.ts), and the
//`messageSessions` row placing it at the end. createMessage is the hottest write path in this
//schema (called on every turn, unlike e.g. forkChatSession), so it's worth keeping to the minimum
//number of round trips: 1 (ownership + last position) + 1 (insert message) + 1 (insert variant) +
//1 (insert placement) = 4.
export async function createMessage(
	chatSessionId: string,
	owner: string,
	params: {
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

	const [message] = await db
		.insert(messages)
		.values({ speakerId: params.speakerId ?? null, meta: params.meta ?? null, owner })
		.returning();

	const [variant] = await db
		.insert(messageVariants)
		.values({
			messageId: message.id,
			content: params.content,
			model: params.model ?? null,
			active: true
		})
		.returning();

	await db.insert(messageSessions).values({
		messageId: message.id,
		chatSessionId,
		position: nextPosition(placement.position)
	});

	return { message, variant };
}

//Edits the content of a message's *currently active* generation in place - not a new swipe, just
//a correction to what's already shown. Leaves messageVariants history (other swipes) untouched.
//Not on a hot path like createMessage, so this keeps the straightforward select-then-update shape
//(2 round trips) rather than folding the ownership check into the UPDATE's WHERE: that would save
//a round trip but lose the ability to tell "nothing matched" from "updated successfully" without
//relying on a rows-affected count, which isn't uniform across every driver behind the borrowed
//`Db` type - not worth the tradeoff for a function that isn't called anywhere near as often.
export async function editMessageContent(
	messageId: string,
	owner: string,
	content: MessageContentBlock[],
	options: { cenv?: any } = {}
) {
	const db = await getDb(options.cenv);

	const [variant] = await db
		.select({ id: messageVariants.id })
		.from(messageVariants)
		.innerJoin(messages, eq(messages.id, messageVariants.messageId))
		.where(
			and(
				eq(messageVariants.messageId, messageId),
				eq(messageVariants.active, true),
				eq(messages.owner, owner)
			)
		);

	if (!variant) throw new Error('Message not found');

	await db
		.update(messageVariants)
		.set({ content, updatedAt: new Date() })
		.where(eq(messageVariants.id, variant.id));
}

//Regenerates a message: deactivates the current variant and inserts a new active one (a new
//swipe). The previous generation isn't deleted - see switchMessageVariant to swipe back to it.
//Deactivate-then-insert (not the other order) because messageVariants_messageId_active_unique_idx
//only allows one active=true row per messageId - inserting a second one before the first is
//deactivated would violate it. That does mean there's a brief window with zero active variants
//for this message between the two statements; nothing currently reads mid-regenerate, so this is
//an accepted tradeoff rather than a correctness issue, same as `messages` briefly having no
//messageSessions row while createMessage is still running.
export async function regenerateMessage(
	messageId: string,
	owner: string,
	params: { content: MessageContentBlock[]; model?: string | null; cenv?: any }
) {
	const db = await getDb(params.cenv);

	const [message] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(and(eq(messages.id, messageId), eq(messages.owner, owner)));

	if (!message) throw new Error('Message not found');

	await db
		.update(messageVariants)
		.set({ active: false })
		.where(and(eq(messageVariants.messageId, messageId), eq(messageVariants.active, true)));

	const [variant] = await db
		.insert(messageVariants)
		.values({ messageId, content: params.content, model: params.model ?? null, active: true })
		.returning();

	return variant;
}

//Swipes a message to an already-existing generation (from an earlier regenerateMessage call)
//instead of creating a new one. A single UPDATE flips the old active row off and the target row
//on together (`active` set to whether each matched row's id equals the target) - not two separate
//statements, so there's no window where either zero or two variants are active at once.
export async function switchMessageVariant(
	messageId: string,
	owner: string,
	variantId: string,
	options: { cenv?: any } = {}
) {
	const db = await getDb(options.cenv);

	//the variant must actually belong to this message, and this message to `owner` - otherwise a
	//caller could point a message at an unrelated variant it doesn't own
	const [variant] = await db
		.select({ id: messageVariants.id })
		.from(messageVariants)
		.innerJoin(messages, eq(messages.id, messageVariants.messageId))
		.where(
			and(
				eq(messageVariants.id, variantId),
				eq(messageVariants.messageId, messageId),
				eq(messages.owner, owner)
			)
		);

	if (!variant) throw new Error('Variant not found');

	await db
		.update(messageVariants)
		.set({ active: sql`${messageVariants.id} = ${variantId}` })
		.where(
			and(
				eq(messageVariants.messageId, messageId),
				or(eq(messageVariants.active, true), eq(messageVariants.id, variantId))
			)
		);
}

//Branches a chat session at `forkAtMessageId` (inclusive): creates a new session, and copies the
//shared prefix's (messageId, position) pairs from messageSessions into it. Never touches
//messages/messageVariants - only small placement rows are copied, so this is cheap regardless of
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
