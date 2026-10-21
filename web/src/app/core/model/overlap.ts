import type { SpecOverlap, SpecWarning } from '../../../../../core/src/files';

/**
 * Spec 025 (ISC-164.1): the pieces of a `spec-overlap` warning the Warnings list, the spec head and the spec context
 * share. core puts the warning once, on the row of the spec that waits (`overlap.waiting`), with that spec's edge
 * (`overlap.edge`); the other spec of the pair finds it here, in the dashboard's rows, and offers the reverse edge.
 */

/** One overlap as one spec of the pair sees it: the other spec, the shared paths and the edge this spec could carry. */
export interface OverlapLine {
  /** The other spec of the pair, `NNN`. */
  readonly other: string;
  readonly paths: readonly string[];
  /** `(after: <other>)`: core's edge on the waiting spec, the reverse direction on the other one. */
  readonly edge: string;
  /** Whether this spec is the one core says waits. */
  readonly waiting: boolean;
}

type Loose = Readonly<Record<string, unknown>>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;

/** A `spec-overlap` warning that carries its pair; core sets `overlap` on that kind only. */
export function overlapOf(warning: SpecWarning): SpecOverlap | null {
  return warning.kind === 'spec-overlap' && warning.overlap !== undefined ? warning.overlap : null;
}

/** The edge `spec` could carry for `overlap`: core's own on the waiting spec, `(after: <waiting>)` on the other. */
export function edgeFor(overlap: SpecOverlap, spec: string): string {
  return overlap.waiting === spec ? overlap.edge : `(after: ${overlap.waiting})`;
}

/**
 * Every overlap pair in an untyped dashboard body (`specs[].warnings`), each once. Read narrowly, the way
 * `ShellData` reads its rows: anything not shaped like core's `SpecOverlap` is skipped.
 */
export function overlapsIn(body: unknown): SpecOverlap[] {
  const rows = isLoose(body) && Array.isArray(body['specs']) ? (body['specs'] as unknown[]) : [];
  const seen = new Set<string>();
  const out: SpecOverlap[] = [];
  for (const row of rows) {
    const warnings = isLoose(row) && Array.isArray(row['warnings']) ? (row['warnings'] as unknown[]) : [];
    for (const warning of warnings) {
      if (!isLoose(warning) || warning['kind'] !== 'spec-overlap' || !isLoose(warning['overlap'])) continue;
      const { specs, paths, waiting, edge } = warning['overlap'];
      if (!Array.isArray(specs) || specs.length !== 2 || !specs.every((s) => typeof s === 'string')) continue;
      if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) continue;
      if (typeof waiting !== 'string' || typeof edge !== 'string') continue;
      const key = `${specs[0]}|${specs[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ specs: [specs[0], specs[1]] as [string, string], paths, waiting, edge });
    }
  }
  return out;
}

/** The overlaps `spec` is part of, each from its side, in the order the dashboard lists them. */
export function overlapLines(overlaps: readonly SpecOverlap[], spec: string): OverlapLine[] {
  return overlaps
    .filter((o) => o.specs.includes(spec))
    .map((o) => ({
      other: o.specs[0] === spec ? o.specs[1] : o.specs[0],
      paths: o.paths,
      edge: edgeFor(o, spec),
      waiting: o.waiting === spec,
    }));
}

/**
 * The shortest suffix of each path, in whole segments, that no other path in the list ends with (`retention/` for
 * `web/src/app/retention/`, `shell/index.ts` beside `board/index.ts`). A directory keeps its trailing slash. Two equal
 * paths keep the full path.
 */
export function pathSuffixes(paths: readonly string[]): string[] {
  const parts = paths.map((path) => {
    const dir = path.endsWith('/');
    return { dir, segs: path.split('/').filter((s) => s !== '') };
  });
  const suffix = ({ dir, segs }: (typeof parts)[number], k: number): string => segs.slice(-k).join('/') + (dir ? '/' : '');
  const whole = parts.map((part) => suffix(part, part.segs.length));
  return parts.map((part, i) => {
    for (let k = 1; k < part.segs.length; k++) {
      const mine = suffix(part, k);
      if (whole.every((other, j) => j === i || (other !== mine && !other.endsWith(`/${mine}`)))) return mine;
    }
    return whole[i];
  });
}

/** What a `spec-edge` diagnostic says, read from core's message: an unknown number or a cycle; null: show the text. */
export type EdgeDiagnostic = { readonly kind: 'unknown'; readonly id: string; readonly from: string } | { readonly kind: 'cycle'; readonly path: string };

export function edgeDiagnostic(warning: SpecWarning): EdgeDiagnostic | null {
  if (warning.kind !== 'spec-edge') return null;
  const unknown = /\(after: (\d{3})\) on (\S+) names no spec/u.exec(warning.text);
  if (unknown) return { kind: 'unknown', id: unknown[1], from: unknown[2] };
  const cycle = /form the cycle (.+?);/u.exec(warning.text);
  return cycle ? { kind: 'cycle', path: cycle[1] } : null;
}
