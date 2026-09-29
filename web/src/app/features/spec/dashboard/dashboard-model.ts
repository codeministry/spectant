import type { GateState, SpecGates } from '../../../../../../core/src/files';
import type { Tone } from '../../../shared/ui/tone';

/**
 * Pure display helpers for the spec dashboard (T53, ISC-78). Nothing here counts: every number the dashboard shows
 * is read from `SpecPageModel` as the parser built it (ISC-72); these helpers only place text and pick a segment.
 */

/** Opening and closing quote marks per UI language (design.md § Spec dashboard: "language-aware quote marks"). */
const EN_MARKS = ['\u201C', '\u201D'] as const;
const QUOTE_MARKS: Partial<Record<string, readonly [string, string]>> = {
  en: ['“', '”'],
  de: ['„', '“'],
};

/** Straight or curly double quotes a source may already carry around the whole sentence. */
const SURROUNDING = /^["“„”](.*)["“”]$/su;

/** The idea quote wrapped in the marks of `lang` (`de-AT` reads as `de`); any other language takes English marks. */
export function quoteIdea(text: string, lang: string): string {
  const [open, close] = QUOTE_MARKS[lang.split('-')[0] ?? ''] ?? EN_MARKS;
  const bare = SURROUNDING.exec(text.trim())?.[1] ?? text.trim();
  return `${open}${bare}${close}`;
}

/** The five segments of the stage track, in order; the labels are `stages.<name>`. */
export const TRACK_STAGES = ['plan', 'tasks', 'review', 'build', 'close'] as const;

/**
 * The track segment a derived stage sits on: `blocked` stays on Build, `code-review` is the last step before Close,
 * `done` is past the last segment (every segment done). An unknown name starts at Plan.
 */
export function stageIndex(stage: string): number {
  switch (stage) {
    case 'blocked':
      return 3;
    case 'code-review':
      return 4;
    case 'done':
      return TRACK_STAGES.length;
    default:
      return Math.max(0, (TRACK_STAGES as readonly string[]).indexOf(stage));
  }
}

/** The gates in the model's order; `codeReviewed` reads as "Code reviewed". Shared with the Status tab (T54). */
export const GATE_NAMES = ['reviewed', 'codeReviewed', 'drift', 'diagrams'] as const satisfies ReadonlyArray<keyof SpecGates>;

/** One colour per gate state: passed in the accent, a stale or warning mark in warning, anything absent neutral. */
export const GATE_TONE: Readonly<Record<GateState, Tone>> = {
  ok: 'accent',
  fresh: 'accent',
  stale: 'warning',
  warn: 'warning',
  missing: 'neutral',
  na: 'neutral',
};
