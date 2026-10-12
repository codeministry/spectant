// The allocation of a story (spec 008, T85, ISC-130.2; FORMAT.md § idea, Allocation): starting a story gives it the
// next free spec number and a folder `specs/NNN-<slug>/` whose first `spec.md` and `context.md` come from the story,
// plus the creation event, the first line of its `events.jsonl`. This module plans that in memory; the server writes it.
//
// The numbering rule: the next number is one past the highest number taken anywhere — a folder in `specs/`, a folder
// in `specs/archive/`, or a number the caller found in branch names and git history. A gap below the highest is never
// reused, because a number once given out may still be named by a branch, a commit or an archived folder, and a
// reused number would make two specs answer to one id.
//
// Pure and browser-safe: texts in, texts out. No file system, no Node or Bun API, nothing written.
import type { EventLine, IdeaRef } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { SPEC_FOLDER } from './spec-ref.ts';

/** The highest number a three-digit folder prefix can carry. */
const MAX_SPEC_NUMBER = 999;

/** What starting one story produces: the folder name, its two first files and its creation event. */
export interface Allocation {
  /** `NNN-<slug>`, the number zero-padded to three digits. */
  readonly folder: string;
  /** The claimless `spec.md` a freshly allocated spec has. */
  readonly specText: string;
  /** `context.md` with Round 0, the story's prompt. */
  readonly contextText: string;
  /** The creation event `{ts, from: null, to: 'plan', command, actor}`, the first line of `events.jsonl`. */
  readonly event: EventLine;
}

/** The numbers of the folder names that have the `NNN-slug` shape (`specs/` and `specs/archive/` alike), in input order. */
export function specNumbersOf(folders: readonly string[]): number[] {
  return folders.flatMap((name) => {
    const id = SPEC_FOLDER.exec(name)?.[1];
    return id === undefined ? [] : [Number(id)];
  });
}

/**
 * The next free spec number: one past the highest taken number, 1 when none is taken. Values that are no spec number
 * (not a positive integer) are ignored. Gaps are not reused (the rule above). The result may exceed 999; `allocationOf`
 * refuses such a number, since it has no three-digit folder.
 */
export function nextSpecNumber(taken: readonly number[]): number {
  let highest = 0;
  for (const n of taken) if (Number.isInteger(n) && n > highest) highest = n;
  return highest + 1;
}

/** A frontmatter value the reader gives back as written: quoted when it would otherwise be trimmed or cut at ` #`. */
function fmValue(value: string): string {
  const plain = value !== '' && value === value.trim() && !/^["']/.test(value) && !/\s#/.test(value);
  return plain ? value : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `key: value` lines between `---` delimiters; a null value leaves its key out. */
function frontmatterBlock(entries: ReadonlyArray<readonly [string, string | null]>): string {
  const lines = entries.filter((e): e is readonly [string, string] => e[1] !== null).map(([k, v]) => `${k}: ${fmValue(v)}`);
  return ['---', ...lines, '---'].join('\n');
}

/** The slug as a heading: hyphens to spaces, the first letter upper-cased (`console-audit-log` → `Console audit log`). */
function headingOf(slug: string): string {
  const words = slug.replace(/-+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Plans the allocation of `idea` under `number`: the folder name, the claimless `spec.md` (frontmatter from the
 * story's keys, `stage: plan`, `phase: scoping`, `started`/`updated` at `now`; an H1 and a `## Goal` holding the story's
 * title; no claims), `context.md` whose Round 0 is the story's prompt — its text after the frontmatter, verbatim, a
 * `## Shaping record` included — and the creation event by `actor`, which passes `validateEventLine`.
 * `storyText` is the story file's text as read. Writes nothing. Throws a RangeError for a number outside 1 to 999 or an
 * invalid `now`: both are a caller's mistake, never a property of the files.
 */
export function allocationOf(idea: IdeaRef, storyText: string, number: number, now: Date, actor: string): Allocation {
  if (!Number.isInteger(number) || number < 1 || number > MAX_SPEC_NUMBER) {
    throw new RangeError(`spec number ${number} is outside 1 to ${MAX_SPEC_NUMBER}`);
  }
  if (Number.isNaN(now.getTime())) throw new RangeError('the allocation time is not a valid date');
  const id = String(number).padStart(3, '0');
  const folder = `${id}-${idea.slug}`;
  const ts = now.toISOString();
  const heading = `${id} — ${headingOf(idea.slug)}`;

  const specText = [
    frontmatterBlock([
      ['slug', folder],
      ['spec_type', idea.type],
      ['isa_feature', idea.feature],
      ['milestone', idea.milestone],
      ['priority', idea.priority],
      ['stage', 'plan'],
      ['phase', 'scoping'],
      ['started', ts],
      ['updated', ts],
    ]),
    '',
    `# ${heading}`,
    '',
    '## Goal',
    '',
    idea.title,
    '',
  ].join('\n');

  const prompt = parseFrontmatter(storyText).body.replace(/^\n+/, '').trimEnd();
  const contextText = [
    frontmatterBlock([
      ['spec', folder],
      ['created', ts],
      ['updated', ts],
      ['rounds', '1'],
    ]),
    '',
    '<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing',
    '     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->',
    '',
    `# Context ${heading}`,
    '',
    `## Round 0 — the story, ${ts}`,
    '',
    prompt,
    '',
  ].join('\n');

  const event: EventLine = { ts, from: null, to: 'plan', command: `/spec new ${idea.slug}`, actor };
  return { folder, specText, contextText, event };
}
