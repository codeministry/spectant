/**
 * Rule `size` (spec 059, ISC-413): no file of the entry has more than `size.maxLines` lines.
 *
 * Lines are counted as an editor numbers them: a final newline does not start another line, and a last line without
 * one still counts. There is no exception list; a long file is split, not exempted.
 */
import { readFileSync } from "node:fs";

import type { Rule, Violation } from "./files.ts";
import { entryFiles, relPath } from "./files.ts";

/** The number of lines of `text`. */
export function countLines(text: string): number {
  if (text === "") return 0;
  let lines = 0;
  for (const char of text) if (char === "\n") lines += 1;
  return text.endsWith("\n") ? lines : lines + 1;
}

export const size: Rule = (entry, repoRoot) => {
  const limit = entry.size?.maxLines;
  if (limit === undefined) return [];
  const violations: Violation[] = [];
  for (const file of entryFiles(entry, repoRoot)) {
    const lines = countLines(readFileSync(file, "utf8"));
    if (lines > limit) {
      violations.push({ rule: "size", file: relPath(repoRoot, file), detail: `${lines} lines, limit ${limit}` });
    }
  }
  return violations;
};
