import type { GuidanceEntry } from '../../../../../core/src/files';
import type { WorkspaceListEntry } from '../../core/api.service';
import { guidanceOfBody, waitingEntries } from '../../core/model/guidance-entry';
import { type WorkingEntry, workingOf } from '../../core/model/working';
import { wsMonogram } from '../../shared/ui/ws-badge/ws-identity';
import { count, isLoose, type Loose, text } from '../../layout/shell/loose';

/** How many Next up rows a workspace column shows (tiles.md § index.html: "up to 3"). */
export const NEXT_UP_LIMIT = 3;

interface Fraction {
  readonly closed: number;
  readonly total: number;
}

/** The kpi-strip's figures: a subset of core's `DashboardKpis` (`core/src/dashboard.ts`), read as served. */
export interface StripKpis {
  readonly master: Fraction | null;
  readonly claims: Fraction;
  readonly specs: number;
  readonly building: number;
  readonly scoping: number;
  readonly warnings: number;
  readonly fog: number;
}

/** One active spec as a column lists it: the dense list and, when it has a command, Next up. */
export interface ColumnRow {
  readonly id: string;
  readonly title: string;
  /** Frontmatter `phase:` as written; the chip's tone comes from `PHASE_TONES`. */
  readonly phase: string | null;
  readonly nextCommand: string | null;
}

/** How many rows the list area of a tile on `/` has room for (spec 066, ISC-518). */
export const TILE_ROW_LIMIT = 3;

/** A tile row of a spec in progress: agent dot, id, title and session. */
export interface TileWorkingRow extends WorkingEntry {
  readonly kind: 'working';
}

/** A tile row of what waits on the principal: glyph, spec id, ref, the spec's title, copy button and since. */
export interface TileWaitingRow {
  readonly kind: 'waiting';
  /** The spec `NNN`. */
  readonly id: string;
  readonly item: GuidanceEntry['item'];
  /** `ISC-N`, `T<n>` or the question's ref; null for a spec. */
  readonly ref: string | null;
  /** The spec's title (spec 064 shows spec titles, not the claim or task text). */
  readonly title: string;
  readonly command: string | null;
  /** ISO 8601; null when the files give none. */
  readonly since: string | null;
}

export type TileRow = TileWorkingRow | TileWaitingRow;

/** The list area of a tile on `/`: at most three rows, in progress before waiting, both counters and the footer's n. */
export interface TileList {
  readonly rows: readonly TileRow[];
  readonly workingCount: number;
  readonly waitsCount: number;
  /** In progress plus waiting, the n of "Show all n". */
  readonly total: number;
  /** True when more entries exist than rows: the footer links to `/w/<ws>`. */
  readonly more: boolean;
}

/**
 * The tile's list area (ISC-518): the specs in progress first, then what waits, cut to `TILE_ROW_LIMIT` rows. A waiting
 * row's title is its spec's title: from `titles` (the column's rows), else a spec entry of the same spec in `waits`
 * (one folded under its spec's front entry too, spec 070), else the entry's own title.
 */
export function tileOf(
  working: readonly WorkingEntry[],
  waits: readonly GuidanceEntry[],
  titles: Readonly<Partial<Record<string, string>>>,
): TileList {
  const listed = new Map(waitingEntries(waits).filter((e) => e.item === 'spec').map((e) => [e.spec, e.title]));
  const all: TileRow[] = [
    ...working.map((entry): TileWorkingRow => ({ kind: 'working', ...entry })),
    ...waits.map(
      (entry): TileWaitingRow => ({
        kind: 'waiting',
        id: entry.spec,
        item: entry.item,
        ref: entry.ref,
        title: titles[entry.spec] ?? listed.get(entry.spec) ?? entry.title,
        command: entry.command,
        since: entry.since,
      }),
    ),
  ];
  const total = all.length;
  return { rows: all.slice(0, TILE_ROW_LIMIT), workingCount: working.length, waitsCount: waits.length, total, more: total > TILE_ROW_LIMIT };
}

/** One readable workspace's column on `/`, read from its dashboard model. */
export interface OverviewColumn {
  readonly slug: string;
  readonly name: string;
  readonly pathTail: string;
  readonly kpis: StripKpis;
  /** The model's Next up order, at most `NEXT_UP_LIMIT`. */
  readonly next: readonly ColumnRow[];
  /** Every active spec in the model's row order. */
  readonly list: readonly ColumnRow[];
  /** `guidance.waits` as served, in core's order (spec 020, ISC-237); empty when the body carries no guidance. */
  readonly waits: readonly GuidanceEntry[];
  /** The specs a session holds a claim of, read by core/model's `workingOf` (spec 064, ISC-461); empty without a lock. */
  readonly working: readonly WorkingEntry[];
  /** The tile's list area over `working` and `waits` (`tileOf`, spec 066 ISC-518). */
  readonly tile: TileList;
  /** Epoch ms the dashboard answered; the ws-head's "Updated n s ago". */
  readonly loadedAt: number;
  /** The stored logo and screenshot URLs from the workspace list (spec 016); null per kind without one. */
  readonly logo: string | null;
  readonly screenshot: string | null;
}

const fraction = (value: unknown): Fraction | null =>
  isLoose(value) ? { closed: count(value['closed']), total: count(value['total']) } : null;

/**
 * Reads a dashboard body narrowly (it is untyped in web, see `DashboardBody` in `core/api.service.ts`): the strip's
 * KPIs as served, the active rows, the Next up ids and `guidance.waits` as served. Derives nothing but the three-row cut; never throws.
 */
export function readColumn(
  entry: Pick<WorkspaceListEntry, 'slug' | 'name' | 'pathTail' | 'images'>,
  body: unknown,
  loadedAt: number,
): OverviewColumn {
  const model: Loose = isLoose(body) ? body : {};
  const k: Loose = isLoose(model['kpis']) ? model['kpis'] : {};
  const kpis: StripKpis = {
    master: fraction(k['master']),
    claims: fraction(k['claims']) ?? { closed: 0, total: 0 },
    specs: count(k['specs']),
    building: count(k['building']),
    scoping: count(k['scoping']),
    warnings: count(k['warnings']),
    fog: count(k['fog']),
  };
  const rows = Array.isArray(model['specs']) ? model['specs'].filter(isLoose) : [];
  const list = rows.flatMap((row): ColumnRow[] => {
    const id = text(row['id']);
    if (id === null) return [];
    return [{ id, title: text(row['title']) ?? id, phase: text(row['phase']), nextCommand: text(row['nextCommand']) }];
  });
  const ids = Array.isArray(model['nextUp']) ? model['nextUp'].filter((id): id is string => typeof id === 'string') : [];
  const next = ids
    .flatMap((id) => list.filter((row) => row.id === id && row.nextCommand !== null))
    .slice(0, NEXT_UP_LIMIT);
  const waits = guidanceOfBody(body)?.waits ?? [];
  const working = workingOf(body);
  const tile = tileOf(working, waits, Object.fromEntries(list.map((row) => [row.id, row.title])));
  const logo = entry.images?.logo ?? null;
  const screenshot = entry.images?.screenshot ?? null;
  const { slug, name, pathTail } = entry;
  return { slug, name, pathTail, kpis, next, list, waits, working, tile, loadedAt, logo, screenshot };
}

/** The workspace badge's monogram (`wsMonogram`): first letters of two words, else two letters. */
export function monogram(name: string): string {
  return wsMonogram(name);
}
