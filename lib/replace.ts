// Find and replace across one file's text: what search shows and what Replace writes.
import { buildPattern, type SearchQuery } from "./text-search.js";

export interface TextMatch {
  offset: number;
  length: number;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The line, clipped to PREVIEW_CHARS around the match. */
  preview: string;
  /** Where the match starts within `preview`. */
  previewStart: number;
  /** The text that replaces the match, when a replacement was given. */
  replacement?: string;
}

const PREVIEW_CHARS = 200;
const PREVIEW_LEAD = 40;

export function compile(query: SearchQuery): RegExp {
  const built = buildPattern(query);
  if (!built.ok) throw new Error(built.error);
  return new RegExp(built.source, built.flags);
}

/**
 * Expand `$&`, `$1`…`$99`, `$<name>` and `$$` the way String.prototype.replace
 * does, against a match found in the whole text (so lookbehind and ^ behave).
 * A literal search (regex off) inserts the replacement as typed.
 */
export function expandReplacement(replacement: string, match: RegExpExecArray, regex: boolean): string {
  if (!regex) return replacement;
  return replacement.replace(/\$(\$|&|<([^>]+)>|(\d{1,2}))/g, (whole, token: string, name?: string, digits?: string) => {
    if (token === "$") return "$";
    if (token === "&") return match[0];
    if (name !== undefined) return match.groups?.[name] ?? "";
    const index = Number(digits);
    if (index > 0 && index < match.length) return match[index] ?? "";
    return whole;
  });
}

export function findMatches(
  text: string,
  query: SearchQuery,
  options: { limit: number; replacement?: string },
): TextMatch[] {
  const pattern = compile(query);
  const results: TextMatch[] = [];
  let line = 1;
  let lineStart = 0;
  let scanned = 0;
  pattern.lastIndex = 0;
  while (results.length < options.limit) {
    const match = pattern.exec(text);
    if (match === null) break;
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    for (; scanned < match.index; scanned++) {
      if (text.charCodeAt(scanned) === 10) {
        line++;
        lineStart = scanned + 1;
      }
    }
    const lineEnd = text.indexOf("\n", match.index);
    const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).replace(/\r$/, "");
    const column = match.index - lineStart;
    const cut = column > PREVIEW_CHARS - PREVIEW_LEAD ? column - PREVIEW_LEAD : 0;
    results.push({
      offset: match.index,
      length: match[0].length,
      line,
      column: column + 1,
      preview: lineText.slice(cut, cut + PREVIEW_CHARS),
      previewStart: column - cut,
      ...(options.replacement === undefined
        ? {}
        : { replacement: expandReplacement(options.replacement, match, query.regex) }),
    });
  }
  return results;
}

/**
 * Replace the matches that start at `offsets` (all when null). Matches are found
 * again in the current text, so an offset that no longer starts a match is skipped
 * rather than corrupting the file.
 */
export function applyReplacements(
  text: string,
  query: SearchQuery,
  replacement: string,
  offsets: ReadonlySet<number> | null,
): { text: string; count: number } {
  const pattern = compile(query);
  let output = "";
  let last = 0;
  let count = 0;
  pattern.lastIndex = 0;
  for (;;) {
    const match = pattern.exec(text);
    if (match === null) break;
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    if (offsets !== null && !offsets.has(match.index)) continue;
    output += text.slice(last, match.index) + expandReplacement(replacement, match, query.regex);
    last = match.index + match[0].length;
    count++;
  }
  return { text: output + text.slice(last), count };
}
