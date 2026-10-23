// The archive listing (T38, ISC-16), ported from the old dashboard's archived rows (SpecArchive keeps the folder's
// location as the fact): every folder under `specs/archive/`, listed and counted, never offered a next step or a
// warning, because archiving closed it. The number stays taken, so it is listed as the folder carries it.
//
// Pure: the folders' texts in, rows out. No file system, no Bun API.
import { parseClaims } from './claims.ts';
import { closedAtOf } from './events.ts';
import type { SpecFiles, SpecType } from './files.ts';
import { parseFrontmatter, type Progress } from './frontmatter.ts';
import { specIdOf, specSlugOf } from './spec-ref.ts';

export interface ArchivedSpec {
  /** The folder's numeric prefix (`specIdOf`), `NNN` for every folder the loader lists; the whole folder name when it has none. */
  readonly id: string;
  /** `NNN-slug`. */
  readonly slug: string;
  /** Frontmatter `task:`, falling back to the slug without its number. */
  readonly title: string;
  readonly type: SpecType | null;
  /** ISO 8601 of the last transition to `done` in the folder's events.jsonl (`closedAtOf`); null otherwise (spec 071, ISC-592). */
  readonly closedAt: string | null;
  /** Frontmatter `archived:` (`YYYY-MM-DD`); null when the folder carries none. */
  readonly archived: string | null;
  readonly archivedReason: string | null;
  /** Live claims, closed over total. */
  readonly claims: Progress;
  readonly tasks: { readonly landed: number; readonly total: number };
  /** The first prose paragraph under `## Goal`, on one line; empty when there is none. */
  readonly goal: string;
}

/** The headings of a spec's goal section: `## Goal`, or `## Ziel` in a German spec. */
export const GOAL_HEADINGS: readonly string[] = ['Goal', 'Ziel'];
/** A task row's checkbox and id: counted only, the full task grammar is tasks.ts (spec 002). */
const TASK_BOX = /^\s*- \[([ xX])\]\s*T\d+\b/gm;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The body of the first level-two section headed exactly one of `headings` (`## Goal`, `## Approach`), up to the next
 * level-two heading or the end of the file, line endings normalised; null when the text has no such section.
 */
export function levelTwoSection(text: string, headings: readonly string[]): string | null {
  const names = headings.map(escapeRegExp).join('|');
  const section = new RegExp(String.raw`^##\s+(?:${names})\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))`, 'm');
  return section.exec(text.replace(/\r\n?/g, '\n'))?.[1] ?? null;
}

/** The first prose paragraph of a section, its lines kept: fences, comments and tables are not prose; null when none. */
export function firstParagraph(section: string): string | null {
  return (
    section
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p !== '' && !p.startsWith('```') && !p.startsWith('~~~') && !p.startsWith('<!--') && !p.startsWith('|')) ?? null
  );
}

/** The first prose paragraph under `## Goal`, on one line: fences, comments and tables are not prose. */
export function goalOf(spec: string): string {
  return (firstParagraph(levelTwoSection(spec, GOAL_HEADINGS) ?? '') ?? '').replace(/\s+/g, ' ');
}

function taskCounts(tasks: string | undefined): { landed: number; total: number } {
  const boxes = [...(tasks ?? '').matchAll(TASK_BOX)];
  return { landed: boxes.filter((m) => m[1] !== ' ').length, total: boxes.length };
}

/** One row per archived folder, in folder order. A folder without spec.md is not a spec and has no row. */
/**
 * A spec's title as every page shows it: the archive summary's title (frontmatter `task:`), else the folder's slug without
 * its number. One rule for the dashboard row and the tech page.
 */
export function specTitle(summary: Pick<ArchivedSpec, 'title'> | undefined, folder: string): string {
  return summary?.title ?? specSlugOf(folder);
}

export function listArchive(folders: readonly SpecFiles[]): ArchivedSpec[] {
  return [...folders]
    .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0))
    .flatMap((f): ArchivedSpec[] => {
      const spec = f.texts.spec;
      if (spec === undefined) return [];
      const { data } = parseFrontmatter(spec);
      return [
        {
          id: specIdOf(f.folder) ?? f.folder,
          slug: f.folder,
          title: data.task ?? specSlugOf(f.folder),
          type: data.specType,
          archived: data.archived,
          archivedReason: data.archivedReason,
          closedAt: closedAtOf(f.texts.events),
          claims: parseClaims(spec).counted,
          tasks: taskCounts(f.texts.tasks),
          goal: goalOf(spec),
        },
      ];
    });
}
