// The claim partition and the seven drift classes (T34, ISC-6), ported from the old SpecStatus tool: IsaFrontier's
// computeFrontier for the partition, computeDrift for the audit of a spec against its master.
// Stub from the T33 seam: the fill-in task replaces the bodies and keeps the exported names and types.
import type { Claim, ClaimsDocument } from './claims.ts';
import type { ClaimLock } from './files.ts';
import type { FrontmatterResult } from './frontmatter.ts';

/**
 * Where each claim stands, as the old frontier computed it. `closed` holds checked and dropped claims (resolved);
 * an open claim is `blocked` while a claim it is `after` is unresolved, `taken` while a lock holds it, else `takeable`.
 */
export interface ClaimPartition {
  readonly closed: readonly string[];
  readonly takeable: readonly string[];
  readonly blocked: ReadonlyArray<{ readonly id: string; readonly openBlockers: readonly string[] }>;
  readonly taken: ReadonlyArray<{ readonly id: string; readonly session: string; readonly since: string }>;
}

/** A claim's state for the spec-versus-master comparison. */
export type ClaimState = 'open' | 'closed' | 'dropped';

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function partitionClaims(_claims: readonly Claim[], _locks?: readonly ClaimLock[]): ClaimPartition {
  throw new Error('not implemented: partitionClaims');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function driftReport(_input: DriftInput): DriftReport {
  throw new Error('not implemented: driftReport');
}

/** True when any drift class is non-empty. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function hasDrift(_report: DriftReport): boolean {
  throw new Error('not implemented: hasDrift');
}
