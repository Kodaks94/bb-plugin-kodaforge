// Adapted from bb-plugin-files-editor (MIT, abdoutelb).
/**
 * Project-wide text search: turning a query into a pattern, and turning raw
 * match offsets into the rows the results list draws.
 *
 * Every query becomes a RegExp — a literal one is escaped first. That gives one
 * code path for case folding (the `i` flag, rather than lowercasing both sides,
 * which shifts offsets for scripts where case changes a string's length) and
 * for whole-word boundaries, and an escaped literal cannot backtrack.
 */

export interface SearchQuery {
  query: string;
  /** Off means smart case: exact only when the query contains a capital. */
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export type BuiltPattern =
  | { ok: true; source: string; flags: string; caseSensitive: boolean }
  | { ok: false; error: string };

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Smart case. In a regex, escapes like `\W` or `\S` are syntax rather than
 * letters, so they must not flip the search to case-sensitive.
 */
export function isCaseSensitive(query: SearchQuery): boolean {
  if (query.matchCase) return true;
  const probe = query.regex ? query.query.replace(/\\./g, "") : query.query;
  return /\p{Lu}/u.test(probe);
}

export function buildPattern(query: SearchQuery): BuiltPattern {
  if (query.query === "") return { ok: false, error: "Type something to search for." };

  const caseSensitive = isCaseSensitive(query);
  const body = query.regex ? query.query : escapeRegExp(query.query);
  const caseFlag = caseSensitive ? "" : "i";

  const attempts: Array<{ source: string; flags: string }> = [];
  if (query.wholeWord) {
    // A Unicode word boundary, so "café" is one word. A user regex that is not
    // valid in Unicode mode falls back to the ASCII \b rather than failing.
    attempts.push({
      source: `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])`,
      flags: `gu${caseFlag}`,
    });
    attempts.push({ source: `\\b(?:${body})\\b`, flags: `g${caseFlag}` });
  } else {
    attempts.push({ source: body, flags: `g${caseFlag}` });
  }

  let lastError = "";
  for (const attempt of attempts) {
    try {
      new RegExp(attempt.source, attempt.flags);
      return { ok: true, ...attempt, caseSensitive };
    } catch (error) {
      // V8 says "Invalid regular expression: /foo(/gi: Unterminated group";
      // keep just the reason, since the pattern is already on screen.
      const message = error instanceof Error ? error.message : String(error);
      lastError = message.slice(message.lastIndexOf(": ") + 2) || message;
    }
  }
  return { ok: false, error: `Not a valid regular expression: ${lastError}` };
}

/** [index, length] pairs in ascending order. */
export type RawMatch = [number, number];

/**
 * Zero-length matches are skipped: a pattern like `a*` matches between every
 * character, which is a flood of empty rows and nothing a person can use.
 */
export function findRawMatches(text: string, pattern: RegExp, limit: number): RawMatch[] {
  const matches: RawMatch[] = [];
  if (limit <= 0) return matches;
  pattern.lastIndex = 0;
  for (;;) {
    const match = pattern.exec(text);
    if (match === null) break;
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    matches.push([match.index, match[0].length]);
    if (matches.length >= limit) break;
  }
  return matches;
}
