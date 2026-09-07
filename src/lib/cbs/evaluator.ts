import type { CbsNode } from './parser';
import { parseCbs } from './parser';

export type CbsFunction = (args: string[], ctx: CbsContext) => string;
export type CbsBlockFunction = (args: string[], children: CbsNode[], ctx: CbsContext) => string;

export interface CbsContext {
	functions: Map<string, CbsFunction>;
	blocks: Map<string, CbsBlockFunction>;
}

export function createCbsContext(): CbsContext {
	return { functions: new Map(), blocks: new Map() };
}

//only {{test}} and the legacy {{#if}} are wired up for now; every other tag/block is
//intentionally unimplemented.
export function createDefaultCbsContext(): CbsContext {
	const ctx = createCbsContext();
	ctx.functions.set('test', () => '0');
	//legacy {{#if <something>}}{{/}}: truthy only when the (trimmed) condition is "1" or "true"
	//(case-insensitive) — no operators, no other truthy values. The rendered body is trimmed too.
	ctx.blocks.set('if', (args, children, blockCtx) => {
		const condition = args.join(' ').trim();
		const isTruthy = condition === '1' || condition.toLowerCase() === 'true';
		if (!isTruthy) return '';
		return evaluateNodes(children, blockCtx).trim();
	});
	return ctx;
}

function evaluateSource(source: string, ctx: CbsContext): string {
	return evaluateNodes(parseCbs(source), ctx);
}

function evaluateNode(node: CbsNode, ctx: CbsContext): string {
	switch (node.type) {
		case 'text':
			return node.value;
		case 'tag': {
			const fn = ctx.functions.get(node.name);
			//unimplemented tag: pass through unresolved rather than silently dropping it
			if (!fn) return node.raw;
			const args = node.args.map((arg) => evaluateSource(arg, ctx));
			return fn(args, ctx);
		}
		case 'block': {
			const fn = ctx.blocks.get(node.name);
			if (!fn) return node.raw;
			const args = node.args.map((arg) => evaluateSource(arg, ctx));
			return fn(args, node.children, ctx);
		}
	}
}

export function evaluateNodes(nodes: CbsNode[], ctx: CbsContext): string {
	return nodes.map((node) => evaluateNode(node, ctx)).join('');
}

export function evaluateCbs(source: string, ctx: CbsContext = createDefaultCbsContext()): string {
	return evaluateSource(source, ctx);
}
