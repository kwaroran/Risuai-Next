export type CbsNode = CbsTextNode | CbsTagNode | CbsBlockNode;

export interface CbsTextNode {
	type: 'text';
	value: string;
}

export interface CbsTagNode {
	type: 'tag';
	name: string;
	args: string[];
	raw: string;
}

export interface CbsBlockNode {
	type: 'block';
	name: string;
	args: string[];
	children: CbsNode[];
	//content of the closing {{/...}} tag. Closing tags can carry any (or no) content — it is never
	//matched against the opening name — so this is kept only for debugging, never for matching.
	closeTag: string | null;
	raw: string;
}

interface TagSpan {
	innerStart: number;
	innerEnd: number;
	end: number;
}

//finds the balanced "}}" for the "{{" at `start`, treating nested "{{"/"}}" pairs as depth changes
//so an arg like {{outer::{{inner}}}} doesn't get truncated at the first "}}" it sees.
function findTagSpan(source: string, start: number): TagSpan | null {
	let depth = 1;
	let i = start + 2;
	while (i < source.length) {
		if (source[i] === '{' && source[i + 1] === '{') {
			depth++;
			i += 2;
			continue;
		}
		if (source[i] === '}' && source[i + 1] === '}') {
			depth--;
			if (depth === 0) {
				return { innerStart: start + 2, innerEnd: i, end: i + 2 };
			}
			i += 2;
			continue;
		}
		i++;
	}
	return null;
}

type SplitMode = 'colon' | 'space';

//splits on "::" (or whitespace runs) only at brace-depth 0, so delimiters inside a nested {{tag}}
//never split the outer arg list.
function splitDepthAware(source: string, mode: SplitMode): string[] {
	if (source === '') return [];

	const parts: string[] = [];
	let depth = 0;
	let current = '';
	let i = 0;

	while (i < source.length) {
		const c = source[i];
		const c2 = source[i + 1];

		if (c === '{' && c2 === '{') {
			depth++;
			current += '{{';
			i += 2;
			continue;
		}
		if (c === '}' && c2 === '}') {
			depth = Math.max(0, depth - 1);
			current += '}}';
			i += 2;
			continue;
		}
		if (depth === 0 && mode === 'colon' && c === ':' && c2 === ':') {
			parts.push(current);
			current = '';
			i += 2;
			continue;
		}
		if (depth === 0 && mode === 'space' && /\s/.test(c)) {
			if (current.length > 0) {
				parts.push(current);
				current = '';
			}
			i++;
			continue;
		}

		current += c;
		i++;
	}

	if (mode === 'colon' || current.length > 0) parts.push(current);
	return parts;
}

function parseColonHeader(source: string): { name: string; args: string[] } {
	const segments = splitDepthAware(source, 'colon');
	if (segments.length === 0) return { name: '', args: [] };
	const [name, ...args] = segments;
	return { name, args };
}

function extractLeadingName(source: string): { name: string; rest: string } {
	let i = 0;
	while (i < source.length && !/[\s:]/.test(source[i])) i++;
	return { name: source.slice(0, i), rest: source.slice(i) };
}

//legacy blocks that take a single space-delimited condition (e.g. {{#if {{a}}}})
//instead of the modern "::"-delimited arg list ({{#when::args}}).
const LEGACY_SPACE_ARG_BLOCKS = new Set(['if']);

function parseBlockHeader(source: string): { name: string; args: string[] } {
	const { name, rest } = extractLeadingName(source);
	if (LEGACY_SPACE_ARG_BLOCKS.has(name.toLowerCase())) {
		return { name, args: splitDepthAware(rest.trim(), 'space') };
	}
	if (rest.startsWith('::')) {
		return { name, args: splitDepthAware(rest.slice(2), 'colon') };
	}
	return { name, args: [] };
}

interface ParseResult {
	nodes: CbsNode[];
	endPos: number;
	closeTag: string | null;
}

//legacy no-arg tags: <bot>/<user>/<char> mean the same as {{bot}}/{{user}}/{{char}}. Recognized in
//the same scan loop as "{{" so they resolve through the exact same tag pipeline wherever they
//appear — including nested inside another tag's args — instead of a separate text-replace pass
//that could either corrupt "{{...}}" boundaries (if run before parsing) or miss occurrences
//consumed as raw args by a real function (if run after evaluation).
const LEGACY_TAGS: readonly { literal: string; name: string }[] = [
	{ literal: '<bot>', name: 'bot' },
	{ literal: '<user>', name: 'user' },
	{ literal: '<char>', name: 'char' }
];

function matchLegacyTag(source: string, i: number): { literal: string; name: string } | null {
	for (const tag of LEGACY_TAGS) {
		if (source.startsWith(tag.literal, i)) return tag;
	}
	return null;
}

//parses text/tag/block nodes starting at `start`. When `stopAtClose` is true (i.e. we're inside a
//block body), the first {{/...}} we hit at this recursion level ends the call instead of becoming
//a node — any {{/...}} belonging to a nested block was already consumed by that block's own
//recursive call.
function parseNodes(source: string, start: number, stopAtClose: boolean): ParseResult {
	const nodes: CbsNode[] = [];
	let i = start;
	let textStart = start;

	const flushText = (end: number) => {
		if (end > textStart) nodes.push({ type: 'text', value: source.slice(textStart, end) });
	};

	while (i < source.length) {
		if (source[i] === '{' && source[i + 1] === '{') {
			const span = findTagSpan(source, i);
			if (!span) {
				i = source.length;
				break;
			}

			const inner = source.slice(span.innerStart, span.innerEnd);
			const raw = source.slice(i, span.end);

			if (inner.startsWith('/')) {
				if (stopAtClose) {
					flushText(i);
					return { nodes, endPos: span.end, closeTag: inner.slice(1) };
				}
				//unmatched close at this level: no block to close, keep it as literal text
				flushText(i);
				nodes.push({ type: 'text', value: raw });
				i = span.end;
				textStart = i;
				continue;
			}

			flushText(i);

			if (inner.startsWith('#')) {
				const { name, args } = parseBlockHeader(inner.slice(1));
				const body = parseNodes(source, span.end, true);
				nodes.push({
					type: 'block',
					name,
					args,
					children: body.nodes,
					closeTag: body.closeTag,
					raw: source.slice(i, body.endPos)
				});
				i = body.endPos;
				textStart = i;
				continue;
			}

			const { name, args } = parseColonHeader(inner);
			nodes.push({ type: 'tag', name, args, raw });
			i = span.end;
			textStart = i;
			continue;
		}

		if (source[i] === '<') {
			const legacy = matchLegacyTag(source, i);
			if (legacy) {
				flushText(i);
				nodes.push({ type: 'tag', name: legacy.name, args: [], raw: legacy.literal });
				i += legacy.literal.length;
				textStart = i;
				continue;
			}
		}

		i++;
	}

	flushText(i);
	return { nodes, endPos: i, closeTag: null };
}

export function parseCbs(source: string): CbsNode[] {
	return parseNodes(source, 0, false).nodes;
}
