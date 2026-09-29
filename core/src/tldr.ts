// The TL;DR (`specs/tldr.md`) and its staleness (T38, ISC-16), ported from the old SpecTldr: sections by their
// `<!-- section: key -->` markers, `generated:` from the frontmatter. Stale when a spec's `updated:` or its newest
// round is later than `generated:` (no file time, no clock, so fixtures stay deterministic); incomplete when a section
// is missing or an open spec goes unnamed.
//
// Pure: text in, model out. No file system, no Bun API. Malformed input yields diagnostics, never a throw.
import type { Diagnostic } from './diagnostics.ts';
import { parseFrontmatter } from './frontmatter.ts';

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
  /**
   * The active specs: number, frontmatter `updated:` and `phase:`, and optionally the ISO 8601 time of the newest
   * `rounds.jsonl` line, since a round moves a spec without touching its `updated:`.
   */
  readonly specs: ReadonlyArray<{
    readonly number: string;
    readonly updated: string | null;
    readonly phase: string | null;
    readonly lastRound?: string | null;
  }>;
}

export interface TldrState {
  readonly present: boolean;
  readonly stale: boolean;
  readonly missingSections: readonly TldrSection[];
  /** Numbers of open specs the TL;DR never names. */
  readonly unnamedSpecs: readonly string[];
}

const MARKER = /<!--\s*section:\s*([\w-]+)\s*-->/;

/** The text names the spec number as a word of its own (`002`, not `1002`). */
function names(text: string, number: string): boolean {
  return new RegExp(String.raw`\b${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`).test(text);
}

/** Read tldr.md: `generated:` and the text between one section marker and the next, a repeated key appended. */
export function parseTldr(text: string): TldrDocument {
  const fm = parseFrontmatter(text);
  const diagnostics: Diagnostic[] = [...fm.diagnostics];
  const generated = fm.values.generated ?? null;
  if (generated === null || generated === '') {
    diagnostics.push({ severity: 'warning', code: 'tldr-generated-missing', message: 'The TL;DR carries no `generated:` time, so it counts as stale.' });
  } else if (Number.isNaN(Date.parse(generated))) {
    diagnostics.push({ severity: 'warning', code: 'tldr-generated-invalid', message: `generated ${generated} is no ISO 8601 time, so the TL;DR counts as stale.` });
  }

  // A Map, then own data properties: a key such as `__proto__` stays a section instead of reaching the prototype.
  const sections = new Map<string, string>();
  const parts = fm.body.split(new RegExp(MARKER.source));
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i] ?? '';
    const body = (parts[i + 1] ?? '').trim();
    const before = sections.get(key);
    sections.set(key, before === undefined ? body : [before, body].filter((s) => s !== '').join('\n\n'));
  }
  return { generated: generated === '' ? null : generated, sections: Object.fromEntries(sections), diagnostics };
}

/** Whether the TL;DR is there, stale, and complete. An absent TL;DR is neither stale nor incomplete: it is absent. */
export function tldrState(input: TldrStateInput): TldrState {
  const { tldr, specs } = input;
  if (!tldr) return { present: false, stale: false, missingSections: [], unnamedSpecs: [] };

  const at = tldr.generated === null ? Number.NaN : Date.parse(tldr.generated);
  // A generated: that is no time says nothing about freshness.
  const stale =
    Number.isNaN(at) ||
    specs.some((s) => [s.updated, s.lastRound ?? null].some((ts) => ts !== null && Date.parse(ts) > at));

  const text = Object.values(tldr.sections).join('\n');
  return {
    present: true,
    stale,
    missingSections: TLDR_SECTIONS.filter((k) => !Object.hasOwn(tldr.sections, k)),
    unnamedSpecs: specs.filter((s) => s.phase !== 'complete' && !names(text, s.number)).map((s) => s.number),
  };
}
