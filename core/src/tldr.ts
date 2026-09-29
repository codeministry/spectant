// The TL;DR (`specs/tldr.md`) and its staleness (T38, ISC-16), ported from the old SpecTldr: sections by their
// `<!-- section: key -->` markers, `generated:` from the frontmatter. Stale when a spec's `updated:` is newer than
// `generated:` (no file time, no clock, so fixtures stay deterministic); incomplete when a section is missing or an
// open spec goes unnamed.
// Stub from the T33 seam: the fill-in task replaces the bodies and keeps the exported names and types.
import type { Diagnostic } from './diagnostics.ts';

export const TLDR_SECTIONS = ['overview', 'try', 'per-spec', 'risks', 'next'] as const;

export type TldrSection = (typeof TLDR_SECTIONS)[number];

export interface TldrDocument {
  /** ISO 8601 from `generated:`; null when absent. */
  readonly generated: string | null;
  /** Markdown per section key, in file order; unknown keys kept. */
  readonly sections: Readonly<Record<string, string>>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface TldrStateInput {
  /** The parsed tldr.md; null when the file does not exist. */
  readonly tldr: TldrDocument | null;
  /** The active specs: number, frontmatter `updated:` and `phase:`. */
  readonly specs: ReadonlyArray<{ readonly number: string; readonly updated: string | null; readonly phase: string | null }>;
}

export interface TldrState {
  readonly present: boolean;
  readonly stale: boolean;
  readonly missingSections: readonly TldrSection[];
  /** Numbers of open specs the TL;DR never names. */
  readonly unnamedSpecs: readonly string[];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function parseTldr(_text: string): TldrDocument {
  throw new Error('not implemented: parseTldr');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function tldrState(_input: TldrStateInput): TldrState {
  throw new Error('not implemented: tldrState');
}
