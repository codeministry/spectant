// The claim partition and the seven drift classes (T34, ISC-6), ported from the old SpecStatus tool: IsaFrontier's
// computeFrontier for the partition, computeDrift for the audit of a spec against its master.
//
// Pure: parsed documents in, model out. No file system, no Bun API. Lock files, the other spec folders and the
// master file are read by the caller; stale locks are the caller's to filter, as readLocks did before computeFrontier.
//
// Deliberate differences, each a superset of the old reading: the partition also lists `open` and `dropped` and
// reports an edge to an unknown ID as a diagnostic (the old frontier left it silently unmet); the master's progress
// check, which the old tool ran once beside the per-spec audit, is `masterProgressMismatch`, so a drifted master is
// reported once per repository and not once per spec.
import { countProgress, formatProgress } from './claims.ts';
import type { Claim, ClaimsDocument } from './claims.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { ClaimLock, MarkState } from './files.ts';
import type { FrontmatterResult } from './frontmatter.ts';

/**
 * Where each claim stands, as the old frontier computed it. `closed` holds checked and dropped claims (resolved);
 * an open claim is `blocked` while a claim it is `after` is unresolved, `taken` while a lock holds it, else `takeable`.
 *
 * The review gate (ISC-99): `takeable` needs a fresh reviewed mark. Without one every claim that would be takeable is
 * `gated` instead: open, neither blocked nor taken, and not takeable, with one `status-review-gate` diagnostic naming
 * the reason. Every layer above (dashboard row, Claims tab, takeable set, live frame) reads this partition, so the gate
 * is decided here once.
 */
export interface ClaimPartition {
  readonly closed: readonly string[];
  readonly takeable: readonly string[];
  readonly blocked: ReadonlyArray<{ readonly id: string; readonly openBlockers: readonly string[] }>;
  readonly taken: ReadonlyArray<{ readonly id: string; readonly session: string; readonly since: string }>;
  /** Every unresolved claim, in file order: takeable, taken and blocked together. */
  readonly open: readonly string[];
  /** The tombstoned claims, in file order; a subset of `closed` (resolved, not achieved). */
  readonly dropped: readonly string[];
  /** Open claims that would be takeable but wait for a fresh reviewed mark, in file order; empty while it is fresh. */
  readonly gated: readonly string[];
  /** The reviewed mark the partition was gated on. */
  readonly reviewed: MarkState;
  /**
   * `status-edge-unknown`: an `after` edge names an ID the file does not hold; the edge counts as unmet.
   * `status-review-gate`: the reviewed mark is missing or stale, so the would-be-takeable claims are gated.
   */
  readonly diagnostics: readonly Diagnostic[];
}

/** A claim's state for the spec-versus-master comparison. */
export type ClaimState = 'open' | 'closed' | 'dropped';

/** A declared `progress:` that disagrees with the recount from the boxes. */
export interface ProgressMismatch {
  readonly file: string;
  readonly declared: string | null;
  readonly counted: string;
}

/** The audit of one spec against its master, one key per drift class; a class is clean when empty, null or 0. */
export interface DriftReport {
  /** A claim ID the spec has and the master does not: the spec minted an ID. */
  readonly unknown_to_master: readonly string[];
  /** Closed in one file, open or dropped in the other. */
  readonly state_mismatch: ReadonlyArray<{ readonly id: string; readonly spec: ClaimState; readonly master: ClaimState }>;
  /** Frontmatter `progress:` disagrees with the recount from the boxes. */
  readonly progress_mismatch: { readonly file: string; readonly declared: string | null; readonly counted: string } | null;
  /** `[x]` with no line under `## Verification`. */
  readonly closed_without_evidence: readonly string[];
  /** A Verification line for a claim that is still open. */
  readonly evidence_without_close: readonly string[];
  /** Claims of the master's `isa_feature` block that the spec does not hold and no other spec folder holds either. */
  readonly missing_in_spec: readonly string[];
  /** At phase complete with a principal_stated_goal: Test Strategy rows without `anchors_to`. */
  readonly anchors_missing_at_complete: number;
}

/** The seven drift class names. */
export type DriftClass = keyof DriftReport;

export interface DriftInput {
  readonly frontmatter: FrontmatterResult;
  readonly spec: ClaimsDocument;
  /** The master's parse; null when the repository has no master, so ID drift cannot be checked. */
  readonly master: ClaimsDocument | null;
  /** Claim IDs held by other spec folders (active or archived), which are therefore not missing from this one. */
  readonly heldElsewhere?: ReadonlySet<string>;
}

function stateOf(claim: Claim): ClaimState {
  return claim.dropped ? 'dropped' : claim.checked ? 'closed' : 'open';
}

/**
 * The locks held on `claims`: one per claim, the reading's last entry winning (the frontier lock, since a reading lists
 * activity first), in claim-ID order. The one selection the live frame (`running` cards, the agents rail) and the
 * dashboard row (`taken`) both use, so the two never name different sessions for a claim (spec 002 T115, ISC-90).
 */
export function heldLocks(locks: readonly ClaimLock[], claims: ReadonlySet<string>): ClaimLock[] {
  const held = new Map<string, ClaimLock>();
  for (const lock of locks) if (claims.has(lock.claim)) held.set(lock.claim, lock);
  return [...held.values()].sort((a, b) => a.claim.localeCompare(b.claim, 'en', { numeric: true }));
}

/**
 * The partition of `claims` under `locks`, gated on the spec's `reviewed` mark. The gate state is required, not
 * defaulted: a caller that could skip it would show takeable claims on an unreviewed spec.
 */
export function partitionClaims(claims: readonly Claim[], locks: readonly ClaimLock[], reviewed: MarkState): ClaimPartition {
  const known = new Set(claims.map((c) => c.id));
  const resolved = new Set(claims.filter((c) => c.checked || c.dropped).map((c) => c.id));
  // Later locks win, as the old Map over the lock list did.
  const lockOf = new Map(locks.map((l) => [l.claim, l]));

  const closed: string[] = [];
  const takeable: string[] = [];
  const blocked: Array<{ id: string; openBlockers: string[] }> = [];
  const taken: Array<{ id: string; session: string; since: string }> = [];
  const open: string[] = [];
  const dropped: string[] = [];
  const gated: string[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const c of claims) {
    for (const b of c.after) {
      if (!known.has(b)) {
        diagnostics.push({
          severity: 'warning',
          code: 'status-edge-unknown',
          message: `${c.id} is after ${b}, which this file does not hold; the edge counts as unmet.`,
          line: c.line,
        });
      }
    }
    if (c.dropped) dropped.push(c.id);
    if (c.checked || c.dropped) {
      closed.push(c.id);
      continue;
    }
    open.push(c.id);
    const openBlockers = c.after.filter((b) => !resolved.has(b));
    if (openBlockers.length > 0) {
      blocked.push({ id: c.id, openBlockers });
      continue;
    }
    const lock = lockOf.get(c.id);
    if (lock) taken.push({ id: c.id, session: lock.session, since: lock.since });
    else if (reviewed === 'fresh') takeable.push(c.id);
    else gated.push(c.id);
  }
  if (gated.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'status-review-gate',
      message: `The reviewed mark is ${reviewed}: ${gated.length} ${gated.length === 1 ? 'claim stays' : 'claims stay'} open, not takeable, until /spec-review records a fresh mark.`,
    });
  }
  return { closed, takeable, blocked, taken, open, dropped, gated, reviewed, diagnostics };
}

/** Declared `progress:` against the recount of `doc`; null when they agree. A missing or unreadable key disagrees. */
export function progressMismatch(frontmatter: FrontmatterResult, doc: ClaimsDocument, file: string): ProgressMismatch | null {
  const declared = frontmatter.data.progress;
  // Recounted from the claims, not read from doc.counted, so a caller's edited claim list is audited as it stands.
  const counted = countProgress(doc.claims);
  if (declared?.closed === counted.closed && declared.total === counted.total) return null;
  // Destructured, not dotted: the web tsconfigs typecheck this module (through planning.ts) with
  // noPropertyAccessFromIndexSignature, while the root lint asks for dot notation over brackets.
  const { progress: declaredText } = frontmatter.values;
  return { file, declared: declaredText ?? null, counted: formatProgress(counted) };
}

/** The master's own progress check (`ISA.md`), run once per repository beside the per-spec audits. */
export function masterProgressMismatch(frontmatter: FrontmatterResult, master: ClaimsDocument, file = 'ISA.md'): ProgressMismatch | null {
  return progressMismatch(frontmatter, master, file);
}

// Test Strategy columns are positional; a row with fewer than six cells has no anchors_to slot at all, which is the
// same failure as an empty one. A one-cell row was never a Strategy row to the old reader.
function anchorsMissing(doc: ClaimsDocument): number {
  return doc.testStrategy.filter((r) => r.cells >= 2 && (r.cells < 6 || r.anchorsTo === '')).length;
}

/**
 * The spec's main feature: the first word of its `isa_feature`, split on whitespace, commas and middle dots
 * (`F2 · F3` → `F2`); null when the value is missing, blank or starts with a separator. `driftReport` and the
 * planning tree both read the main feature through here.
 */
export function mainFeatureOf(isaFeature: string | null | undefined): string | null {
  const first = isaFeature?.trim().split(/[\s,·]+/u)[0];
  return first === undefined || first === '' ? null : first;
}

export function driftReport(input: DriftInput): DriftReport {
  const { frontmatter, spec, master } = input;
  const heldElsewhere = input.heldElsewhere ?? new Set<string>();
  const fm = frontmatter.data;
  const byId = new Map(spec.claims.map((c) => [c.id, c]));
  const evidence = new Set(spec.verification.map((v) => v.id));

  const evidenceWithoutClose = [...evidence].filter((id) => {
    const c = byId.get(id);
    return c !== undefined && !c.checked && !c.dropped;
  });

  // A bug spec appends its regression claims to the block of the feature it broke; those belong to that spec, which
  // is why claims another folder holds are not missing here. Claims from other blocks in this spec are not drift.
  const feature = mainFeatureOf(fm.isaFeature);
  const missingInSpec: string[] = [];
  if (master && feature !== null) {
    const masterById = new Map(master.claims.map((c) => [c.id, c]));
    const block = master.features.find((f) => f.id === feature);
    for (const id of block?.claims ?? []) {
      if (byId.has(id) || heldElsewhere.has(id) || masterById.get(id)?.dropped) continue;
      missingInSpec.push(id);
    }
  }

  const unknownToMaster: string[] = [];
  const stateMismatch: Array<{ id: string; spec: ClaimState; master: ClaimState }> = [];
  if (master) {
    const masterById = new Map(master.claims.map((c) => [c.id, c]));
    for (const c of spec.claims) {
      const m = masterById.get(c.id);
      if (!m) {
        unknownToMaster.push(c.id);
        continue;
      }
      const specState = stateOf(c);
      const masterState = stateOf(m);
      if (specState !== masterState) stateMismatch.push({ id: c.id, spec: specState, master: masterState });
    }
  }

  return {
    unknown_to_master: unknownToMaster,
    state_mismatch: stateMismatch,
    progress_mismatch: progressMismatch(frontmatter, spec, 'spec.md'),
    closed_without_evidence: spec.claims.filter((c) => c.checked && !c.dropped && !evidence.has(c.id)).map((c) => c.id),
    evidence_without_close: evidenceWithoutClose,
    missing_in_spec: missingInSpec,
    anchors_missing_at_complete: fm.phase === 'complete' && fm.principalStatedGoal ? anchorsMissing(spec) : 0,
  };
}

/** True when any drift class is non-empty. */
export function hasDrift(report: DriftReport): boolean {
  return (
    report.unknown_to_master.length > 0 ||
    report.state_mismatch.length > 0 ||
    report.progress_mismatch !== null ||
    report.closed_without_evidence.length > 0 ||
    report.evidence_without_close.length > 0 ||
    report.missing_in_spec.length > 0 ||
    report.anchors_missing_at_complete > 0
  );
}
