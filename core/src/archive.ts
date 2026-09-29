// The archive listing (T38, ISC-16), ported from the old dashboard's archived rows (SpecArchive keeps the folder's
// location as the fact): every folder under `specs/archive/`, listed and counted, never offered a next step or a
// warning, because archiving closed it. The number stays taken, so it is listed as the folder carries it.
//
// Pure: the folders' texts in, rows out. No file system, no Bun API.
import { parseClaims } from './claims.ts';
import type { SpecFiles, SpecType } from './files.ts';
import { parseFrontmatter, type Progress } from './frontmatter.ts';

export interface ArchivedSpec {
  /** `NNN`. */
  readonly id: string;
  /** `NNN-slug`. */
  readonly slug: string;
  /** Frontmatter `task:`, falling back to the slug without its number. */
  readonly title: string;
  readonly type: SpecType | null;
  /** Frontmatter `archived:` (`YYYY-MM-DD`); null when the folder carries none. */
  readonly archived: string | null;
  readonly archivedReason: string | null;
  /** Live claims, closed over total. */
  readonly claims: Progress;
  readonly tasks: { readonly landed: number; readonly total: number };
  /** The first prose paragraph under `## Goal`, on one line; empty when there is none. */
  readonly goal: string;
}

/** The `## Goal` (or `## Ziel`) section up to the next level-two heading or the end of the file. */
const GOAL = /^##\s+(?:Goal|Ziel)\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m;
/** A task row's checkbox and id: counted only, the full task grammar is tasks.ts (spec 002). */
const TASK_BOX = /^\s*- \[([ xX])\]\s*T\d+\b/gm;

/** The first prose paragraph under `## Goal`, on one line: fences, comments and tables are not prose. */
export function goalOf(spec: string): string {
  const section = GOAL.exec(spec.replace(/\r\n?/g, '\n'))?.[1] ?? '';
  const para = section
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p !== '' && !p.startsWith('```') && !p.startsWith('~~~') && !p.startsWith('<!--') && !p.startsWith('|'));
  return (para ?? '').replace(/\s+/g, ' ');
}

function taskCounts(tasks: string | undefined): { landed: number; total: number } {
  const boxes = [...(tasks ?? '').matchAll(TASK_BOX)];
  return { landed: boxes.filter((m) => m[1] !== ' ').length, total: boxes.length };
}

/** One row per archived folder, in folder order. A folder without spec.md is not a spec and has no row. */
export function listArchive(folders: readonly SpecFiles[]): ArchivedSpec[] {
  return [...folders]
    .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0))
    .flatMap((f): ArchivedSpec[] => {
      const spec = f.texts.spec;
      if (spec === undefined) return [];
      const { data } = parseFrontmatter(spec);
      return [
        {
          id: f.folder.slice(0, 3),
          slug: f.folder,
          title: data.task ?? f.folder.replace(/^\d+-/, ''),
          type: data.specType,
          archived: data.archived,
          archivedReason: data.archivedReason,
          claims: parseClaims(spec).counted,
          tasks: taskCounts(f.texts.tasks),
          goal: goalOf(spec),
        },
      ];
    });
}
