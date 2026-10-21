import type { GuidanceEntry } from '../../../../../core/src/files';
import type { WorkspaceListEntry } from '../../core/api.service';
import { guidanceOfBody } from '../../core/model/guidance-entry';
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
  const logo = entry.images?.logo ?? null;
  const screenshot = entry.images?.screenshot ?? null;
  return { slug: entry.slug, name: entry.name, pathTail: entry.pathTail, kpis, next, list, waits, working, loadedAt, logo, screenshot };
}

/** The workspace badge's monogram (prototype `identity.js` `mono`): first letters of two words, else two letters. */
export function monogram(name: string): string {
  return wsMonogram(name);
}
