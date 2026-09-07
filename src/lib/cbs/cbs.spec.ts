import { describe, expect, it } from 'vitest';
import { parseCbs } from './parser';
import { createDefaultCbsContext, evaluateCbs, evaluateNodes } from './evaluator';

describe('parseCbs', () => {
	it('parses a plain tag with no args', () => {
		const [node] = parseCbs('{{test}}');
		expect(node).toMatchObject({ type: 'tag', name: 'test', args: [] });
	});

	it('parses "::"-separated args', () => {
		const [node] = parseCbs('{{the::args::is::like::these}}');
		expect(node).toMatchObject({
			type: 'tag',
			name: 'the',
			args: ['args', 'is', 'like', 'these']
		});
	});

	it('parses a block whose closing tag content is arbitrary', () => {
		const [node] = parseCbs('{{#wehaveblocks}}body{{/endingcanendwithanything}}');
		expect(node).toMatchObject({
			type: 'block',
			name: 'wehaveblocks',
			args: [],
			closeTag: 'endingcanendwithanything'
		});
	});

	it('parses a block with args and a bare "{{/}}" closing tag', () => {
		const [node] = parseCbs('{{#blocks::can::have::args::too!}}{{/}}');
		expect(node).toMatchObject({
			type: 'block',
			name: 'blocks',
			args: ['can', 'have', 'args', 'too!'],
			closeTag: ''
		});
	});

	it('parses nested tags inside a block body and inside another tag\'s args', () => {
		const [node] = parseCbs('{{#the}} data {{nesting::{{must}}::also}}{{/work}}');
		if (node.type !== 'block') throw new Error('expected a block node');

		expect(node.name).toBe('the');
		expect(node.closeTag).toBe('work');
		expect(node.children).toMatchObject([
			{ type: 'text', value: ' data ' },
			{ type: 'tag', name: 'nesting', args: ['{{must}}', 'also'] }
		]);
	});

	it('keeps multi-line arg content intact', () => {
		const [node] = parseCbs('{{multi::\nline should work\n}}');
		expect(node).toMatchObject({
			type: 'tag',
			name: 'multi',
			args: ['\nline should work\n']
		});
	});

	it('parses the legacy #if block using space-separated args instead of ::', () => {
		const [node] = parseCbs('{{#if {{statement}}}}{{/}}');
		expect(node).toMatchObject({
			type: 'block',
			name: 'if',
			args: ['{{statement}}'],
			closeTag: ''
		});
	});

	it('splits legacy #if args on whitespace while still respecting nested braces', () => {
		const [node] = parseCbs('{{#if {{getvar::a}} {{getvar::b}}}}{{/}}');
		expect(node).toMatchObject({
			type: 'block',
			name: 'if',
			args: ['{{getvar::a}}', '{{getvar::b}}']
		});
	});

	it('does not use the legacy space syntax for modern blocks', () => {
		const [node] = parseCbs('{{#when::args::here}}{{/}}');
		expect(node).toMatchObject({
			type: 'block',
			name: 'when',
			args: ['args', 'here']
		});
	});

	it('falls back to literal text for an unterminated tag', () => {
		const nodes = parseCbs('hello {{oops');
		expect(nodes).toMatchObject([{ type: 'text', value: 'hello {{oops' }]);
	});

	it('keeps an unmatched closing tag as literal text', () => {
		const nodes = parseCbs('hello {{/oops}} world');
		expect(nodes.every((node) => node.type === 'text')).toBe(true);
		expect(nodes.map((node) => (node as { value: string }).value).join('')).toBe(
			'hello {{/oops}} world'
		);
	});

	it('parses legacy <bot>/<user>/<char> as the same shape of tag node as {{bot}}/{{user}}/{{char}}', () => {
		expect(parseCbs('<bot>')).toMatchObject([{ type: 'tag', name: 'bot', args: [] }]);
		expect(parseCbs('<user>')).toMatchObject([{ type: 'tag', name: 'user', args: [] }]);
		expect(parseCbs('<char>')).toMatchObject([{ type: 'tag', name: 'char', args: [] }]);
		expect(parseCbs('{{user}}')).toMatchObject([{ type: 'tag', name: 'user', args: [] }]);
	});

	it('recognizes a legacy tag nested inside another tag\'s args', () => {
		const [node] = parseCbs('{{this::nested::<user>::should::work}}');
		expect(node).toMatchObject({
			type: 'tag',
			name: 'this',
			args: ['nested', '<user>', 'should', 'work']
		});

		const argNodes = parseCbs('<user>');
		expect(argNodes).toMatchObject([{ type: 'tag', name: 'user', args: [] }]);
	});

	it('leaves an unrelated "<" alone', () => {
		const nodes = parseCbs('1 < 2');
		expect(nodes).toMatchObject([{ type: 'text', value: '1 < 2' }]);
	});
});

describe('evaluateCbs', () => {
	it('evaluates {{test}} to "0"', () => {
		expect(evaluateCbs('{{test}}')).toBe('0');
	});

	it('passes unimplemented tags through unresolved', () => {
		const source = '{{the::args::is::like::these}}';
		expect(evaluateCbs(source)).toBe(source);
	});

	it('passes unimplemented blocks through unresolved, raw source intact', () => {
		const source = '{{#wehaveblocks}}body{{/endingcanendwithanything}}';
		expect(evaluateCbs(source)).toBe(source);
	});

	it('recursively evaluates nested tags inside args before calling the outer function', () => {
		const ctx = createDefaultCbsContext();
		ctx.functions.set('upper', (args) => args[0].toUpperCase());
		expect(evaluateCbs('{{upper::{{test}}}}', ctx)).toBe('0');
	});

	it('mixes plain text with tags', () => {
		expect(evaluateCbs('value is {{test}}!')).toBe('value is 0!');
	});

	it('resolves <user> the same way {{user}} would, even nested inside another tag\'s args', () => {
		const ctx = createDefaultCbsContext();
		ctx.functions.set('user', () => 'Alice');
		ctx.functions.set('this', (args) => args.join('|'));

		expect(evaluateCbs('{{this::nested::<user>::should::work}}', ctx)).toBe(
			'nested|Alice|should|work'
		);
		expect(evaluateCbs('{{this::nested::{{user}}::should::work}}', ctx)).toBe(
			'nested|Alice|should|work'
		);
	});

	it('resolves a legacy tag nested inside a block body', () => {
		const ctx = createDefaultCbsContext();
		ctx.functions.set('user', () => 'Alice');
		ctx.blocks.set('block', (_args, children, blockCtx) => evaluateNodes(children, blockCtx));

		expect(evaluateCbs('{{#block}}hi <user>{{/}}', ctx)).toBe('hi Alice');
	});

	describe('legacy {{#if}}', () => {
		it('renders the body when the condition is "1"', () => {
			expect(evaluateCbs('{{#if 1}} shown {{/}}')).toBe('shown');
		});

		it('renders the body when the condition is "true"', () => {
			expect(evaluateCbs('{{#if true}} shown {{/}}')).toBe('shown');
		});

		it('renders nothing for any other condition value', () => {
			expect(evaluateCbs('{{#if 0}}hidden{{/}}')).toBe('');
			expect(evaluateCbs('{{#if false}}hidden{{/}}')).toBe('');
			expect(evaluateCbs('{{#if yes}}hidden{{/}}')).toBe('');
		});

		it('treats "true" case-insensitively, but not "1"-like values', () => {
			expect(evaluateCbs('{{#if True}} shown {{/}}')).toBe('shown');
			expect(evaluateCbs('{{#if TRUE}} shown {{/}}')).toBe('shown');
			expect(evaluateCbs('{{#if tRuE}} shown {{/}}')).toBe('shown');
		});

		it('ignores extra whitespace around the condition', () => {
			expect(evaluateCbs('{{#if   1   }}shown{{/}}')).toBe('shown');
		});

		it('resolves nested tags in the condition before comparing', () => {
			const ctx = createDefaultCbsContext();
			ctx.functions.set('flag', () => 'true');
			expect(evaluateCbs('{{#if {{flag}}}} shown {{/}}', ctx)).toBe('shown');
		});

		it('trims the rendered body even when truthy', () => {
			expect(evaluateCbs('{{#if 1}}   padded text   {{/}}')).toBe('padded text');
		});
	});
});
