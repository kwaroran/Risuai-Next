import { generateKeyBetween } from 'fractional-indexing';

//Every `position` column in schema.ts (messageSessions, regexscripts) is a fractional-indexing
//string: sortable as plain text, and a new key can always be generated between/after/before
//existing ones without renumbering siblings. Backed by the `fractional-indexing` package rather
//than hand-rolled, since getting the base-N arithmetic right (and not running out of precision
//under repeated inserts at the same spot) is easy to get subtly wrong.
export { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

//Convenience for the common case: the key for a new item appended after everything currently in
//a list. `lastPosition` is the current last item's position, or null for an empty list.
export function nextPosition(lastPosition: string | null): string {
	return generateKeyBetween(lastPosition, null);
}
