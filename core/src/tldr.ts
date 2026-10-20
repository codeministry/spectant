// The TL;DR (`specs/tldr.md`) and its staleness (T38, ISC-16), ported from the old SpecTldr: sections by their
// `<!-- section: key -->` markers, `generated:` and the optional `lang:` from the frontmatter. Stale when a spec's
// `updated:` or its newest round is later than `generated:` (no file time, no clock, so fixtures stay deterministic);
// incomplete when a section is missing or an open spec goes unnamed.
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
  /**
   * The primary language from `lang:`, a BCP 47 tag such as `de` or `de-CH` (spec 021, ISC-247), trimmed; null when
   * absent, empty or no such tag. Optional in the file, so a missing or malformed value is never a diagnostic.
   */
  readonly lang: string | null;
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

/** One `<!-- section: key -->` marker, the key captured; `tech.ts` marks the same markers for the library (ISC-355). */
export const MARKER = /<!--\s*section:\s*([\w-]+)\s*-->/;

/** The text names the spec number as a word of its own (`002`, not `1002`). */
function names(text: string, number: string): boolean {
  return new RegExp(String.raw`\b${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`).test(text);
}

/**
 * A BCP 47 language tag as `lang:` takes it: a primary subtag of two or three letters, then hyphenated subtags of one to
 * eight letters or digits (`de`, `en`, `de-CH`, `zh-Hant-TW`). Shape only, no registry lookup.
 */
const LANG_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/** `lang:` trimmed when it is a language tag, else null. */
function langOf(value: string | undefined): string | null {
  const lang = value?.trim() ?? '';
  return LANG_TAG.test(lang) ? lang : null;
}

/**
 * Read tldr.md: `generated:`, `lang:` and the text between one section marker and the next, a repeated key appended.
 */
export function parseTldr(text: string): TldrDocument {
  const fm = parseFrontmatter(text);
  const diagnostics: Diagnostic[] = [...fm.diagnostics];
  const generated = fm.values.generated ?? null;
  if (generated === null || generated === '') {
    diagnostics.push({ severity: 'warning', code: 'tldr-generated-missing', message: 'The TL;DR carries no `generated:` time, so it counts as stale.' });
  } else if (Number.isNaN(Date.parse(generated))) {
    diagnostics.push({ severity: 'warning', code: 'tldr-generated-invalid', message: `generated ${generated} is no ISO 8601 time, so the TL;DR counts as stale.` });
  }

  return {
    generated: generated === '' ? null : generated,
    sections: sectionsByMarker(fm.body),
    lang: langOf(fm.values.lang),
    diagnostics,
  };
}

/**
 * The text between one `<!-- section: key -->` marker and the next, per key in file order: text before the first marker
 * belongs to no section, a repeated key's parts are joined with a blank line, each part trimmed. The one marker reader
 * of tldr.md and tech.md (`tech.ts`).
 */
export function sectionsByMarker(body: string): Readonly<Record<string, string>> {
  // A Map, then own data properties: a key such as `__proto__` stays a section instead of reaching the prototype.
  const sections = new Map<string, string>();
  const parts = body.split(new RegExp(MARKER.source));
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i] ?? '';
    const part = (parts[i + 1] ?? '').trim();
    const before = sections.get(key);
    sections.set(key, before === undefined ? part : [before, part].filter((s) => s !== '').join('\n\n'));
  }
  return Object.fromEntries(sections);
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
