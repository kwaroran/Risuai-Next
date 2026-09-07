# CBS parser (`src/lib/cbs/`)

A from-scratch parser/evaluator for CBS (`{{these}}`), the macro syntax
the original Risuai. This module only implements the _engine_ — parsing, brace-nesting, arg
splitting, block structure — plus a minimal evaluator. Almost no actual macros are implemented
yet; see [What's implemented](#whats-implemented) below.

## Files

- `src/lib/cbs/parser.ts` — turns a source string into a `CbsNode[]` AST. Pure, no execution
  semantics.
- `src/lib/cbs/evaluator.ts` — walks the AST and produces a string, given a `CbsContext` of
  registered tag/block functions.
- `src/lib/cbs/index.ts` — barrel export of both.
- `src/lib/cbs/cbs.spec.ts` — vitest coverage of every syntax rule below. Run with
  `npx vitest run src/lib/cbs`.

## Syntax supported

- **Plain tags**: `{{name}}`, or with `::`-separated args: `{{name::arg1::arg2}}`.
- **Blocks**: `{{#name}}...{{/anything}}`. The closing tag's content is never matched against the
  opening name — `{{/}}`, `{{/foo}}`, `{{/whatever}}` all just close the nearest open block. Block
  args use the same `::` syntax as plain tags: `{{#name::arg1::arg2}}`.
- **Legacy `{{#if ...}}`**: unlike every other block, `#if`'s condition is space-delimited, not
  `::`-delimited (`{{#if {{a}}}}` rather than `{{#when::a::b}}`). This is handled as a
  special case — see `LEGACY_SPACE_ARG_BLOCKS` in `parser.ts`. **If you find another legacy block
  that uses the same space-delimited style, add its name to that set** rather than writing a new
  code path.
- **Arbitrary nesting**: `{{outer::{{inner}}}}` and nesting inside block bodies both work. This is
  driven by brace-depth tracking in `findTagSpan` (finds the matching `}}` for a `{{`) and
  `splitDepthAware` (splits args on `::` or whitespace, but only at depth 0) — nested `{{}}` is
  never split or truncated early.
- **Multi-line args**: `{{multi::\nline\n}}` — newlines inside an arg are ordinary characters, no
  special handling needed.
- **Legacy `<bot>` / `<user>` / `<char>`**: no-arg tokens equivalent to `{{bot}}` / `{{user}}` /
  `{{char}}`. Recognized in the exact same source-scan loop as `{{`, producing the same `tag` node
  shape, so they resolve correctly even when nested inside another tag's args (e.g.
  `{{this::nested::<user>::should::work}}`) or inside a block body. **Deliberately not implemented
  as a separate text-replace pass** — replacing before parsing risks corrupting `{{}}` boundaries
  if a resolved value contains `::`/`{{`/`}}`; replacing after evaluation misses occurrences that a
  real function consumes as a raw arg. If more legacy no-arg tokens turn up, add them to
  `LEGACY_TAGS` in `parser.ts`.

## What's implemented

`createDefaultCbsContext()` registers:

- `{{test}}` — returns `"0"`.
- `{{#if <something>}}...{{/}}` (legacy space-syntax only) — truthy only when the resolved
  condition, trimmed, is `"1"` or `"true"` (case-insensitive for `"true"`, e.g. `"True"`/`"TRUE"`
  also count; `"1"` has no case variant). Nothing else is truthy, and there's no operator support —
  this is a plain string-equality check, not an expression evaluator. When truthy, renders its
  children with `evaluateNodes` and `.trim()`s the result; when falsy, renders `""`.

Everything else — `bot`/`user`/`char`, `#when`, and any other macro — is **unimplemented on
purpose**: the goal so far has been the parsing/evaluation engine, not the macro library. An
unresolved tag or block evaluates to its own raw original source text (see `node.raw` in
`evaluator.ts`) rather than disappearing, so unimplemented syntax stays visibly unresolved in
output.

## Extending it

- **Add a tag function**: `ctx.functions.set('name', (args, ctx) => ...)`. `args` are already
  fully recursively evaluated (nested tags inside them are resolved first) before your function is
  called.
- **Add a block function**: `ctx.blocks.set('name', (args, children, ctx) => ...)`. `args` are
  resolved the same way; `children` is the **unevaluated** child `CbsNode[]` — call
  `evaluateNodes(children, ctx)` yourself. This is deliberate: it's what lets a real `#if` only
  evaluate the branch it needs instead of always evaluating both.
- `createCbsContext()` gives you an empty context if you don't want the `test` default.

## Known gaps / next steps

- `bot`/`user`/`char` are parsed but not resolved to real values yet — no function is registered
  for them by default (see [What's implemented](#whats-implemented)).
- `{{#if}}` only does a string-equality truthy check (`"1"` / `"true"`) on the whole condition, no
  more. `#when` and any other block are still fully unimplemented — the parser understands their
  _syntax_ but nothing executes them.
- `LEGACY_SPACE_ARG_BLOCKS` currently only contains `if`. If other legacy space-syntax blocks are
  found, add them there instead of duplicating the special-case logic.
- `LEGACY_TAGS` currently only contains `bot`/`user`/`char`. Same pattern applies for any other
  legacy angle-bracket tokens found later.
