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
  /** Epoch ms the dashboard answered; the ws-head's "Updated n s ago". */
  readonly loadedAt: number;
}

type Loose = Readonly<Record<string, unknown>>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const fraction = (value: unknown): Fraction | null =>
  isLoose(value) ? { closed: count(value['closed']), total: count(value['total']) } : null;

/**
 * Reads a dashboard body narrowly (it is untyped in web, see `DashboardBody` in `core/api.service.ts`): the strip's
 * KPIs as served, the active rows and the Next up ids. Derives nothing but the three-row cut; never throws.
 */
export function readColumn(
  entry: { readonly slug: string; readonly name: string; readonly pathTail: string },
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
  return { slug: entry.slug, name: entry.name, pathTail: entry.pathTail, kpis, next, list, loadedAt };
}

/** The workspace badge's monogram (prototype `identity.js` `mono`): first letters of two words, else two letters. */
export function monogram(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return '?';
  const lead = words.length > 1 ? words.slice(0, 2).map((word) => word.charAt(0)).join('') : words.join('').slice(0, 2);
  return lead.toUpperCase();
}
