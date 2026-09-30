// Milestones of the master ISA: the level-two `## Milestones` section, one bullet per milestone,
// `- <name> · <YYYY-MM-DD> · <description?>`. Only a top-level bullet (no leading whitespace) is a milestone line; an
// indented bullet is a note under its entry and is ignored silently. Any heading (`#` to `######`) or a `---` rule
// ends the section. Entries come back in file order; sorting by date is the planning tree's job. A bullet without a valid ISO date is a `master-milestone-line` warning and is skipped; a bullet repeating
// an earlier entry's name or slug is a `master-milestone-duplicate` warning and is skipped, so every slug is unique.
// The name part of every skipped line that has one comes back in `skipped`, so the planning tree can tell a name the
// master lists but could not use from one it never lists.
//
// Pure: text in, model out. No file system, no Bun API. Malformed input yields diagnostics, never a throw.
import type { Diagnostic } from './diagnostics.ts';

export interface Milestone {
  readonly name: string;
  /** Kebab-cased name, see `milestoneSlug`. */
  readonly slug: string;
  /** ISO date `YYYY-MM-DD`. */
  readonly target: string;
  readonly description: string | null;
  /** 1-based line in the parsed text. */
  readonly line: number;
}

export interface MilestonesDocument {
  readonly milestones: readonly Milestone[];
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The name part of every skipped line (`master-milestone-line` or `master-milestone-duplicate`), in file order; a
   * line without a name adds nothing. A line without any separator counts its whole text as the name.
   */
  readonly skipped: readonly string[];
}

const HEADING = /^##\s+Milestones\b/i;
/** Any ATX heading, `#` to `######`, ends the section; so does a `---` rule. */
const ANY_HEADING = /^#{1,6}\s/;
const RULE = /^---\s*$/;
const FENCE = /^\s*(```|~~~)/;
/** A top-level bullet only: an indented one is a note under the entry above and is ignored without a diagnostic. */
const BULLET = /^[-*]\s+(.*?)\s*$/;
/**
 * The field separator: a `·` with whitespace on both sides, where either end of the (trimmed) bullet body counts as
 * whitespace. So `B · 2026-01-02 ·` still ends in an empty description, and a bare `·` inside a name is part of it.
 */
const SEPARATOR = /(?:^|\s)·(?=\s|$)/u;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Lower-cased, every run of characters outside `a`-`z` and `0`-`9` becomes one `-`, none at either end. */
export function milestoneSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** `name · date · description`: the body split at its first two separators, each part trimmed; later ones stay in the description. */
function fields(body: string): string[] {
  const parts: string[] = [];
  let rest = body;
  for (let k = 0; k < 2; k++) {
    const m = SEPARATOR.exec(rest);
    if (m === null) break;
    parts.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
  }
  parts.push(rest);
  return parts.map((part) => part.trim());
}

function validDate(text: string): boolean {
  const m = ISO_DATE.exec(text);
  if (m === null) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function parseMilestones(text: string): MilestonesDocument {
  const milestones: Milestone[] = [];
  const diagnostics: Diagnostic[] = [];
  const skipped: string[] = [];
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');

  const seen = new Set<string>();
  let fence: string | null = null;
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const fenceMark = FENCE.exec(raw)?.[1] ?? null;
    if (fence === null && fenceMark !== null) {
      fence = fenceMark;
      continue;
    }
    if (fence !== null) {
      if (fenceMark === fence) fence = null;
      continue;
    }
    if (!inSection) {
      if (HEADING.test(raw)) inSection = true;
      continue;
    }
    if (ANY_HEADING.test(raw) || RULE.test(raw)) break;

    const body = BULLET.exec(raw)?.[1];
    if (body === undefined) continue;
    const line = i + 1;

    const [name = '', target = '', description = ''] = fields(body);
    if (name === '' || !validDate(target)) {
      if (name !== '') skipped.push(name);
      diagnostics.push({
        severity: 'warning',
        code: 'master-milestone-line',
        message: 'A milestone line needs `- <name> · <YYYY-MM-DD> · <description?>`; this one is skipped.',
        line,
      });
      continue;
    }
    const slug = milestoneSlug(name);
    // One set holds names and slugs alike: a repeated name, or a second name kebab-casing to a taken slug, would give
    // two rows one track key and one `#m-<slug>` anchor. The first entry wins.
    if (seen.has(name) || seen.has(`slug:${slug}`)) {
      skipped.push(name);
      diagnostics.push({
        severity: 'warning',
        code: 'master-milestone-duplicate',
        message: `Milestone "${name}" repeats an earlier entry (same name or slug "${slug}"); this one is skipped.`,
        line,
      });
      continue;
    }
    seen.add(name).add(`slug:${slug}`);
    milestones.push({ name, slug, target, description: description === '' ? null : description, line });
  }
  return { milestones, diagnostics, skipped };
}
