/**
 * The dashboard's key numbers as a pure types module: `DashboardKpis` and `StageGroup`, re-exported by `dashboard.ts`.
 * Kept apart so a browser-safe contract (the workspace admin contract, spec 016) can type a summary's `counts`
 * without type-checking `dashboard.ts`' value graph (`gates.ts` uses Node's `Buffer`).
 */
import type { SpecType } from './files.ts';
import type { Progress } from './frontmatter.ts';

/**
 * The groups the Specs tile splits the active specs into and the spec list filters them by (spec 021, ISC-245), in
 * lifecycle order: `building` is a stage of `BUILDING`, `complete` is `done`, `scoping` is every other stage. One
 * derivation from the row's derived stage, never from the frontmatter `phase:`, so the tile's split and the filter's
 * counts cannot disagree.
 */
export type StageGroup = 'scoping' | 'building' | 'complete';

/**
 * The key numbers above the spec list. Each tile's number comes with its reference, the count it stands against
 * (spec 021, ISC-245), so the band shows a fraction or an "of N" from the model alone and computes nothing itself.
 * Each reference field says which tile it serves.
 */
export interface DashboardKpis {
  /** Active (not archived) spec folders: the Specs tile's number and the reference of its split. */
  readonly specs: number;
  /** Active specs at stage build, blocked, code-review or close-pending (`stageGroups.building`). */
  readonly building: number;
  /** Active specs at any other stage but done (`stageGroups.scoping`). */
  readonly scoping: number;
  /**
   * The Specs tile's split: the active specs per stage group, counted from each row's `stageGroup`, the same field the
   * spec list filters by. The three counts sum to `specs`; `building` and `scoping` equal the fields of that name.
   */
  readonly stageGroups: Readonly<Record<StageGroup, number>>;
  /** The master's recounted progress, e.g. 101/124; null without a master or without a claim section in it. */
  readonly master: Progress | null;
  /** The master's claims not yet closed, `master.total − master.closed`: the master tile's open count; null without `master`. */
  readonly masterOpen: number | null;
  /**
   * The master's whole percent closed, floored so 100 means every master claim is closed: the master tile's ring; null
   * without `master` or without a claim in it.
   */
  readonly masterPercent: number | null;
  /**
   * The active specs per frontmatter `type:`, one entry per type present, keys in name order: the spec list's type chips.
   * A spec without a type counts in no entry.
   */
  readonly byType: Readonly<Partial<Record<SpecType, number>>>;
  /** Live claims over the open (active, not done) specs. */
  readonly claims: Progress;
  /** Tasks over the open specs. */
  readonly tasks: { readonly landed: number; readonly total: number };
  /** Takeable claims over the active specs: the Takeable tile's number. */
  readonly takeable: number;
  /**
   * The Takeable tile's reference: the live claims not yet closed over the same active specs `takeable` counts, so
   * `takeable` never exceeds it.
   */
  readonly openClaims: number;
  /** Warnings over the active specs: the Warnings tile's number. */
  readonly warnings: number;
  /** The Warnings tile's reference: the active specs carrying at least one warning, of `specs`. */
  readonly specsWithWarnings: number;
  /** Fog lines over the master and the active specs: the Open fog tile's number. */
  readonly fog: number;
  /** The Open fog tile's reference: the active specs with at least one fog line, of `specs` (the filter's fog chip). */
  readonly specsWithFog: number;
  /** The fog lines of the master alone; `fog` less this is the active specs' fog. */
  readonly masterFog: number;
  /** Warnings plus open fog, kept for existing readers; the KPI band shows `warnings` and `fog` as two tiles instead. */
  readonly attention: number;
  /** Folders under `specs/archive/`: no tile of its own, the spec list's head shows it. */
  readonly archived: number;
}
