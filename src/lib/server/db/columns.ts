//Dialect-agnostic column/table helpers used by schema.ts.
//Each helper picks the real Postgres or SQLite column builder at module-load time based on
//`isPg`, but is typed as whatever the SQLite builder would return so schema.ts (and anything
//reading its exported tables) gets normal Drizzle autocomplete regardless of which dialect is
//actually active. The pg branch is cast into that shape with `as unknown as` - the runtime
//column is still a real pg column, only its compile-time type is borrowed from the sqlite one.
import * as pg from 'drizzle-orm/pg-core';
import * as sqlite from 'drizzle-orm/sqlite-core';
import { isPg } from './dialect';

export const table = (isPg ? pg.pgTable : sqlite.sqliteTable) as typeof sqlite.sqliteTable;
export const index = (isPg ? pg.index : sqlite.index) as typeof sqlite.index;
export const uniqueIndex = (isPg ? pg.uniqueIndex : sqlite.uniqueIndex) as typeof sqlite.uniqueIndex;

//Type-only escape hatch for circular `.references()` thunks (e.g. two tables that reference each
//other's `id`). Annotate the thunk's return type with this - `(): AnyColumn => otherTable.col` -
//to break the TS inference cycle that would otherwise make both tables implicitly `any`.
export type AnyColumn = sqlite.AnySQLiteColumn;

//id(): UUID text primary key, generated app-side
function idBase(name: string) {
	return sqlite
		.text(name)
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
}
export function id(name = 'id') {
	if (isPg) {
		return pg
			.text(name)
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()) as unknown as ReturnType<typeof idBase>;
	}
	return idBase(name);
}

//text(): plain string column
function textBase(name: string) {
	return sqlite.text(name);
}
export function text(name: string) {
	if (isPg) return pg.text(name) as unknown as ReturnType<typeof textBase>;
	return textBase(name);
}

//int(): plain numeric column (small enum-like codes, counters, etc.)
function intBase(name: string) {
	return sqlite.integer(name);
}
export function int(name: string) {
	if (isPg) return pg.integer(name) as unknown as ReturnType<typeof intBase>;
	return intBase(name);
}

//boolean(): true/false column (stored as 0/1 on sqlite, native boolean on pg)
function booleanBase(name: string) {
	return sqlite.integer(name, { mode: 'boolean' });
}
export function boolean(name: string) {
	if (isPg) return pg.boolean(name) as unknown as ReturnType<typeof booleanBase>;
	return booleanBase(name);
}

//json<T>(): arbitrary JSON-serializable value (text+JSON mode on sqlite, native jsonb on pg)
function jsonBase<T>(name: string) {
	return sqlite.text(name, { mode: 'json' }).$type<T>();
}
export function json<T>(name: string) {
	if (isPg) return pg.jsonb(name).$type<T>() as unknown as ReturnType<typeof jsonBase<T>>;
	return jsonBase<T>(name);
}

//timestamp(): always surfaces as a JS Date in application code (unix epoch int on sqlite,
//native timestamp on pg). No DB-level default - set defaults app-side via $defaultFn so
//behavior is identical across dialects.
function timestampBase(name: string) {
	return sqlite.integer(name, { mode: 'timestamp' });
}
export function timestamp(name: string) {
	if (isPg) return pg.timestamp(name) as unknown as ReturnType<typeof timestampBase>;
	return timestampBase(name);
}
