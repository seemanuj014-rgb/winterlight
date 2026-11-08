import letterRaw from '../../content/letter.md?raw';
import wishesRaw from '../../content/wishes.json?raw';
import namesRaw from '../../content/names.json?raw';
import creditsRaw from '../../content/credits.json?raw';
import { assertContent, type Content, type Issue } from './validate';

export type { Content, Issue } from './validate';
export { ContentError, PLACEHOLDER } from './validate';

/** Production builds are strict. The flag is injected by vite.config.ts; absent (tests, tools) means not strict. */
export function isStrictBuild(): boolean {
  return typeof __STRICT_CONTENT__ !== 'undefined' && __STRICT_CONTENT__ === true;
}

/**
 * Loads the owner's four content files. Throws ContentError on broken files, and, in a strict
 * build, on any TODO_OWNER. In dev, placeholders load fine and are returned so callers can log them.
 */
export function loadContent(strict: boolean = isStrictBuild()): { content: Content; placeholders: Issue[] } {
  return assertContent({ letter: letterRaw, wishes: wishesRaw, names: namesRaw, credits: creditsRaw }, strict);
}
