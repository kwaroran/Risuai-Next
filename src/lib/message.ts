//One generation of a message - the first generation and every "swipe"/regenerate afterwards each
//get their own entry in `messages.variants` (src/lib/server/db/schema.ts). Isomorphic (no
//server-only imports) so both the server and the chat UI can import it.
export interface MessageVariant {
	//ordered content blocks for this generation, see MessageContentBlock below
	content: MessageContentBlock[];

	//which model generated this variant. Null for a human-authored variant (the message's
	//speakerId is null). Recorded per-variant rather than trusting chatSessions.linkedModel,
	//since swipes/regenerates can each use a different model - and since some
	//MessageContentBlock fields (ThoughtBlock's `ref`/`hash`) are only valid replayed back to
	//the exact model/provider that produced them
	model: string | null;

	//creation time, unix epoch milliseconds (a JSON column can't hold a Date)
	createdAt: number;

	//last edited time, unix epoch milliseconds - omitted if never edited since creation
	updatedAt?: number;
}

//Shape of `MessageVariant.content`. One turn's generation is an ordered array of these blocks -
//plain assistant/user text, model reasoning, agentic tool use, and embedded files all interleave
//in one array rather than living in separate columns, since a single turn can freely mix them
//(e.g. thought -> toolCall -> toolResult -> text).
export type MessageContentBlock =
	TextBlock | ThoughtBlock | ToolCallBlock | ToolResultBlock | FileBlock;

export interface TextBlock {
	type: 'text';
	text: string;
}

export interface ThoughtBlock {
	type: 'thought';
	//full reasoning text, when the provider exposes it at all
	text?: string;
	//provider-condensed summary of the reasoning. Some providers (e.g. OpenAI's reasoning models)
	//only ever expose a summary, never raw `text` - both are optional and independent, not one
	//derived from the other
	summary?: string;
	//opaque id some providers use to reference this reasoning item in a later call (e.g. to
	//continue or verify a chain of thought across turns) - not meant to be rendered. Only valid
	//replayed back to the same model/provider that issued it - check the parent
	//MessageVariant.model before reusing it, since a later call may use a different model
	ref?: string;
	//opaque signature/hash some providers attach to a thinking block so they can verify it wasn't
	//tampered with when it's replayed back to them on a later call (e.g. Anthropic's thinking
	//signature) - must be sent back byte-for-byte, never derived or regenerated locally. Same
	//model-scoping caveat as `ref` above
	hash?: string;
	//true when the reasoning content itself was withheld by the model provider (e.g. Anthropic's
	//redacted thinking blocks) - `text`/`summary` may be empty or opaque in that case
	redacted?: boolean;
}

export interface ToolCallBlock {
	type: 'toolCall';
	//id used to match this call to its ToolResultBlock
	id: string;
	name: string;
	args: unknown;
}

export interface ToolResultBlock {
	type: 'toolResult';
	//matches a ToolCallBlock.id - not necessarily from the same message, since a tool call and
	//its result can land on separate turns
	toolCallId: string;
	result: unknown;
	isError?: boolean;
}

export interface FileBlock {
	type: 'file';
	//references files.id (src/lib/server/db/schema.ts) - not a DB-level foreign key since it's
	//nested inside a JSON column, so deleting a file does not cascade into content blocks
	fileId: string;
	name?: string;
	mimeType?: string;
}
