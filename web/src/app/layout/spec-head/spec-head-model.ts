/**
 * Pure display helpers for the spec head and its gate button (T78, ISC-85, ISC-22). Nothing here derives a stage or a
 * gate state: the helpers only pick which of the button's four states the model's facts put it in, whether the stage
 * offers the gate at all, and how a path, a slug and a time read.
 */
import type { ClaimLock, GateView } from '../../../../../core/src/files';
import type { PlanningFeature, PlanningHolder, PlanningModel } from '../../../../../core/src/planning';
import { specIdOf, specRefMatches, specSlugOf } from '../../../../../core/src/spec-ref';

/** The gate button's four states (design.md § Status, ISC-85). */
export type GateAction = 'ready' | 'stale' | 'done' | 'paused';

/**
 * The reviewed gate's button: any lock on this spec pauses writes (a 423 would answer anyway, ISC-86), a stale mark
 * asks for a new review, a fresh one is done, and anything else (no mark yet) is ready.
 */
export function gateAction(reviewed: GateView, lock: ClaimLock | null): GateAction {
  if (lock !== null) return 'paused';
  if (reviewed.state === 'stale') return 'stale';
  if (reviewed.state === 'fresh') return 'done';
  return 'ready';
}

/** The stages whose head carries the gate button: from tasks on, while the spec is still open. */
const HEAD_GATE_STAGES: ReadonlySet<string> = new Set(['tasks', 'review', 'build', 'blocked', 'code-review']);

/** "When the stage allows" (design.md § Spec head): not before there is a plan to review, not once it is done. */
export function gateInHead(stage: string): boolean {
  return HEAD_GATE_STAGES.has(stage);
}

/** A path cut after each `/`, so the template can offer a line break there (`<wbr>`) and nowhere else. */
export function pathSegments(path: string): readonly string[] {
  return path.split(/(?<=\/)/u).filter((segment) => segment.length > 0);
}

/** The first twelve hex digits of a hash for display; null for a file that does not exist. */
export function shortHash(hash: string | null): string | null {
  return hash === null ? null : hash.slice(0, 12);
}

/** The folder name without its `NNN-` prefix: `002-web-console` reads "web-console" beside the mono id (core's rule). */
export const slugName = (slug: string): string => specSlugOf(slug);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The largest unit that keeps a signed distance readable (negative: in the past), rounded to whole units. */
export function relativeUnit(deltaMs: number): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const abs = Math.abs(deltaMs);
  if (abs < MINUTE) return { value: Math.round(deltaMs / SECOND), unit: 'second' };
  if (abs < HOUR) return { value: Math.round(deltaMs / MINUTE), unit: 'minute' };
  if (abs < DAY) return { value: Math.round(deltaMs / HOUR), unit: 'hour' };
  if (abs < 30 * DAY) return { value: Math.round(deltaMs / DAY), unit: 'day' };
  if (abs < 365 * DAY) return { value: Math.round(deltaMs / (30 * DAY)), unit: 'month' };
  return { value: Math.round(deltaMs / (365 * DAY)), unit: 'year' };
}

/** `iso` relative to `now` in the UI language ("5 minutes ago", "vor 5 Minuten"); null for no or no readable date. */
export function relativeTime(iso: string | null, now: number, lang: string): string | null {
  if (iso === null) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const { value, unit } = relativeUnit(then - now);
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(value, unit);
}

// ─── Breadcrumb (T39, ISC-105) ────────────────────────────────────────────────────────────────────────────────────

/** The claim or task the open tab shows. */
export interface OpenItem {
  readonly kind: 'claim' | 'task';
  readonly id: string;
}

/**
 * The open claim or task: the Claims and Tasks tabs deep-link one by fragment (`#claim-ISC-…`, `#task-T<n>`, see
 * `claims-tab.ts` and `tasks-tab.ts`) and keep no other selection state, so the breadcrumb reads that fragment alone.
 */
export function openItem(tab: string | null, fragment: string | null): OpenItem | null {
  if (fragment === null) return null;
  for (const [kind, onTab] of [['claim', 'claims'], ['task', 'tasks']] as const) {
    const prefix = `${kind}-`;
    if (tab === onTab && fragment.startsWith(prefix) && fragment.length > prefix.length) return { kind, id: fragment.slice(prefix.length) };
  }
  return null;
}

/**
 * Whether the holder is the spec `ref` names, in every form the route's `:id` accepts: the id `NNN`, the folder
 * `NNN-slug` or the bare slug — core's `specRefMatches`, the same rule `resolveSpec` applies on the server. Until the
 * spec body answers the head knows only the raw route param, so matching the id alone would drop the planning levels
 * for the other two forms.
 */
const matchesHolder = (holder: Pick<PlanningHolder, 'slug'>, ref: string): boolean => specRefMatches(holder.slug, ref);

/** The feature crumb and the other blocks the spec holds, which the "+n" popover lists in master order. */
export interface FeaturePlace {
  readonly crumb: PlanningFeature | null;
  readonly others: readonly PlanningFeature[];
}

/**
 * The feature crumb (design § The breadcrumb, "Which feature"): the open claim's own block when a claim is open and the
 * spec holds that block, else the spec's main feature (`main` on its holder entry), else the first block it holds (a
 * spec whose `isa_feature` names a block it holds no claim of). A claim the spec lists but another folder won
 * (planning's winner rule) sits in a block the spec does not hold, so it falls through to the main feature rather than
 * crowd it into the "+n" popover. The others are every other block the spec holds.
 */
export function featurePlace(model: PlanningModel, specId: string, claimId: string | null): FeaturePlace {
  const held = model.features.filter((f) => f.holders.some((h) => matchesHolder(h, specId)));
  const own = claimId === null ? undefined : held.find((f) => f.claims.some((c) => c.id === claimId));
  const main = held.find((f) => f.holders.some((h) => h.main && matchesHolder(h, specId)));
  const crumb = own ?? main ?? held.at(0) ?? null;
  return { crumb, others: held.filter((f) => f !== crumb) };
}

/** The spec's milestone: an entry of the master's block, or a name the block lacks (ISC-101.1). */
export type MilestonePlace =
  | { readonly known: true; readonly name: string; readonly slug: string }
  | { readonly known: false; readonly name: string | null };

const UNKNOWN_MILESTONE = 'spec-milestone-unknown';

/**
 * The milestone whose `specs` lists the spec, else the tree's `spec-milestone-unknown` diagnostic on the spec's
 * `spec.md`; null when the spec names none. The unknown name is the diagnostic's `subject` (core sets it to the
 * frontmatter value verbatim); a diagnostic without one shows no name.
 */
export function milestonePlace(model: PlanningModel, specId: string): MilestonePlace | null {
  const entry = model.milestones.find((m) => m.specs.some((h) => matchesHolder(h, specId)));
  if (entry) return { known: true, name: entry.name, slug: entry.slug };
  const unknown = model.diagnostics.find(({ file, diagnostic }) => {
    const parts = file.split('/');
    const folder = parts.at(-2) ?? '';
    return diagnostic.code === UNKNOWN_MILESTONE && parts.at(-1) === 'spec.md' && specIdOf(folder) !== null && specRefMatches(folder, specId);
  });
  if (!unknown) return null;
  return { known: false, name: unknown.diagnostic.subject ?? null };
}

/** The holder entry of `specId` (any form the route accepts) anywhere in the tree (folder name, archived flag), or null. */
export function holderOf(model: PlanningModel, specId: string): PlanningHolder | null {
  for (const list of [...model.features.map((f) => f.holders), ...model.milestones.map((m) => m.specs)]) {
    const found = list.find((h) => matchesHolder(h, specId));
    if (found) return found;
  }
  return null;
}
