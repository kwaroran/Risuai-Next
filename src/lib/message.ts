//`messages.role` (src/lib/server/db/schema.ts) - which side of the conversation a message is on,
//as sent to the model. Stored as a small integer like the schema's other enums, since real enum
//columns differ across SQLite/Postgres. Deliberately separate from `messages.speakerId` (*who*
//spoke): a module can author a user-role message (e.g. "write my reply for me"), and a deleted
//module's messages must stay assistant messages even after their speakerId is nulled.
export const MessageRole = {
	User: 0,
	Assistant: 1,
	System: 2
} as const;
export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

//One generation of a message - the first generation and every "swipe"/regenerate afterwards each
//get their own entry in `messages.variants` (src/lib/server/db/schema.ts). Isomorphic (no
//server-only imports) so both the server and the chat UI can import it.
export interface MessageVariant {
	//ordered content blocks for this generation, see MessageContentBlock below
	content: MessageContentBlock[];

	//which model generated this variant. Null for a human-authored variant. Recorded per-variant rather than trusting chatSessions.linkedModel,
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
	| TextBlock
	| ThoughtBlock
	| ToolCallBlock
	| ToolResultBlock
	| FileBlock
	| ErrorBlock
	| CommentBlock;

//Blocks that are shown in the UI but never sent to a model. The prompt builder must drop these -
//use isPromptBlock below rather than re-listing them, so a new UI-only block type only has to be
//added here.
export type UiOnlyBlock = ErrorBlock | CommentBlock;

export function isPromptBlock(
	block: MessageContentBlock
): block is Exclude<MessageContentBlock, UiOnlyBlock> {
	return block.type !== 'error' && block.type !== 'comment';
}

export interface TextBlock {
	type: 'text';
	text: string;
	//sources the provider attributed this text to (web search grounding, document citations).
	//Kept on the text itself rather than as a separate block, since a citation belongs to a
	//specific span of this text
	citations?: Citation[];
}

export interface Citation {
	//where the cited material came from - a URL, an uploaded file (files.id), or both absent when
	//the provider only gives a title/quote
	url?: string;
	fileId?: string;
	title?: string;
	//the quoted source text, when the provider gives it
	quote?: string;
	//the span of the parent TextBlock.text this citation supports, as [start, end) UTF-16 offsets
	//(JS string indices). Omitted when the citation applies to the whole block
	start?: number;
	end?: number;
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

//Who actually ran a tool call:
//client   - this app executed it (a module/app-defined tool). The default when omitted. Portable
//           across models as long as the same tool is declared in the later request.
//provider - the model provider ran one of its own built-in tools server-side (e.g. web search,
//           code execution). Only replayable as a tool call to a provider that has the same
//           built-in tool - see `providerData` below for the fallback rule when switching models.
export type ToolExecutor = 'client' | 'provider';

//Canonical names for provider built-in tools, so the same kind of tool reads the same regardless
//of which provider ran it - which is what lets a different provider's adapter rebuild the call
//(or flatten it to text) after a model switch, and lets the UI render it one way. Any other
//string is still a valid ToolCallBlock.name (client tools, or provider tools not normalized yet).
export type CanonicalToolName = 'web_search' | 'web_fetch' | 'code_execution';

export interface ToolCallBlock {
	type: 'toolCall';
	//id used to match this call to its ToolResultBlock
	id: string;
	//a CanonicalToolName when this is a normalized provider built-in tool
	name: CanonicalToolName | (string & {});
	args: unknown;
	executor?: ToolExecutor;
	//opaque original provider payload for this call, for byte-exact replay. Only valid replayed
	//back to the same provider/model that produced it - check the parent MessageVariant.model
	//first, same caveat as ThoughtBlock.ref/hash. When replaying a `provider`-executed call to a
	//different model: rebuild it from name/args/result if that provider has the same built-in
	//tool, otherwise flatten the call + result into text, since most APIs reject a tool call for
	//a tool that isn't declared in the request
	providerData?: unknown;
}

export interface ToolResultBlock {
	type: 'toolResult';
	//matches a ToolCallBlock.id - not necessarily from the same message, since a tool call and
	//its result can land on separate turns
	toolCallId: string;
	//what the model sees as this tool's output: plain text, or text/file blocks when the output
	//includes media (e.g. an image a tool produced). Structured output from a client tool is
	//serialized to text here
	result: string | ToolResultContentBlock[];
	//structured form of the output, for the UI and for rebuilding the call on a model switch. For
	//canonical tools, the normalized shape (WebSearchResult, WebFetchResult, CodeExecutionResult
	//below); anything else is tool-defined. Not sent to the model directly - `result` is
	data?: unknown;
	isError?: boolean;
	//same as ToolCallBlock.providerData
	providerData?: unknown;
}

//blocks allowed inside ToolResultBlock.result - what model APIs accept as tool output
export type ToolResultContentBlock = TextBlock | FileBlock;

//normalized `data` of a `web_search` tool call
export interface WebSearchResult {
	hits: { url: string; title?: string; snippet?: string }[];
}

//normalized `data` of a `web_fetch` tool call
export interface WebFetchResult {
	url: string;
	title?: string;
	//page content as the provider returned it (usually text/markdown)
	content: string;
}

//normalized `data` of a `code_execution` tool call
export interface CodeExecutionResult {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	//files the code produced, stored like any other uploaded file
	files?: FileBlock[];
}

export interface FileBlock {
	type: 'file';
	//references files.id (src/lib/server/db/schema.ts) - not a DB-level foreign key since it's
	//nested inside a JSON column, so deleting a file does not cascade into content blocks
	fileId: string;
	name?: string;
	mimeType?: string;
}

//A generation that failed partway (stream dropped, provider error, etc.). Lets the UI keep and
//show whatever arrived before the failure, with the error marked inline, instead of discarding
//the whole generation. UI-only: never sent to a model (see isPromptBlock)
export interface ErrorBlock {
	type: 'error';
	message: string;
	//provider/HTTP error code, when there is one
	code?: string;
}

//A note shown in the chat UI but never sent to a model (see isPromptBlock) - e.g. an author's
//note to themselves, or an app/module annotation on a message
export interface CommentBlock {
	type: 'comment';
	text: string;
}
