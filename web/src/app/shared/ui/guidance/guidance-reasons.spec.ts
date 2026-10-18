// Catalogue guard for ISC-237.1 (spec 020, T12): every reason key the core can put on a guidance entry
// (`GUIDANCE_REASONS`, generated from the stage table and the three waiting-on-you kinds) reads as one whole sentence
// in the user's language, in both catalogues, under `guidance.reason.<key>`.
//
// Per key and language:
//   - a sentence exists;
//   - its Transloco params are exactly the template's placeholders that read in any language: `{ref}` (an ID) and
//     `{state}`, which the pipe fills with the catalogue word `guidance.value.state.<missing|stale>`, never the raw
//     machine word. `{type}`, `{claims}`, `{ids}` and `{is}` carry core's English prose ("13 claims", "ISC-7 and
//     ISC-9", "are"), so no sentence uses them: the sentence says what to do without them;
//   - no tool word (takeable, fresh, stale, tasks.md, plan.md, "mark is", ISC-, /spec-), no ellipsis, no claim ID as
//     the subject (the sentence never starts with `{{ids}}` or `{{ref}}`), ends with a sentence mark, and stays at or
//     under 100 characters once filled with sample values.
// Beside the reasons: the labels of the waits block exist in both languages, the German label never says "wartet"
// (spec 040 names the waiting state with it), and `guidance` holds the same key set in both catalogues.
//
// The checkers are proven on synthetic input first, so a green run cannot come from a checker that finds nothing.
//
// The keys come from core's `GUIDANCE_REASONS` (core/src/guidance-reasons.ts, browser-safe), never derived here; the
// guidance golden, which core's own test pins, proves every key it carries is listed and fills its template.
import { GUIDANCE_REASONS } from '../../../../../../core/src/guidance-reasons';
import golden from '../../../../../../core/fixtures/guidance.guidance.golden.json';
import de from '../../../../i18n/de.json';
import en from '../../../../i18n/en.json';

type Nested = Readonly<Record<string, unknown>>;

/** The template's whole-phrase pattern, every placeholder some non-empty text. */
const templatePattern = (template: string): RegExp =>
  new RegExp(`^${template.split(/\{[a-zA-Z]+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);

interface GoldenEntry {
  readonly reason: { readonly key: string; readonly phrase: string };
}
const GOLDEN_ENTRIES: readonly GoldenEntry[] = [...(golden.waits as GoldenEntry[]), ...(golden.next as GoldenEntry[])];

const CATALOGUES = { en: en as Nested, de: de as Nested } as const;
const LANGS = ['en', 'de'] as const;

/** The string at a dotted path of a nested catalogue (segments may hold `-`), or undefined. */
function at(catalogue: Nested, path: string): string | undefined {
  let node: unknown = catalogue;
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Nested)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Every dotted leaf path under `node`. */
function leaves(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix];
  return Object.entries(node as Nested).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

/** Transloco params of one value: `{{ids}}`, `{{ state }}`. */
const params = (value: string): string[] => [...new Set([...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))].sort();

const fill = (value: string, values: Readonly<Record<string, string>>): string =>
  value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) => values[name] ?? whole);

const TOOL_WORDS = /takeable|\bfresh\b|\bstale\b|tasks\.md|plan\.md|mark is|ISC-|\/spec-/i;
const ELLIPSIS = /…|\.\.\./;
const SENTENCE_END = /[.!?]$/;
const ID_SUBJECT = /^\s*\{\{\s*(ids|ref)\s*\}\}/;
const MAX_FILLED = 100;

/** Placeholders whose values are core's English prose: never a param of a sentence. `state` is filled from these words. */
const PROSE = new Set(['type', 'claims', 'ids', 'is']);
const STATE_VALUES = ['missing', 'stale'] as const;

/** Long-ish sample values, as the core fills them (see the goldens): the length check runs on these. */
const SAMPLES: Readonly<Record<string, string>> = { ref: 'ISC-237.1' };

/** What is wrong with one sentence for one template's placeholders; empty when it is fine. */
function problems(sentence: string | undefined, placeholders: readonly string[], stateWords: readonly string[]): string[] {
  if (sentence === undefined || sentence.trim() === '') return ['no sentence'];
  const out: string[] = [];
  const expected = placeholders.filter((p) => !PROSE.has(p)).sort();
  const got = params(sentence);
  if (got.join(',') !== expected.join(',')) out.push(`params {${got.join(',')}} instead of {${expected.join(',')}}`);
  if (TOOL_WORDS.test(sentence)) out.push(`tool word: ${TOOL_WORDS.exec(sentence)?.[0] ?? ''}`);
  if (ELLIPSIS.test(sentence)) out.push('ellipsis');
  if (!SENTENCE_END.test(sentence.trim())) out.push('no sentence mark at the end');
  if (ID_SUBJECT.test(sentence)) out.push('a claim ID is the subject');
  for (const state of placeholders.includes('state') ? stateWords : ['']) {
    const filled = fill(sentence, { ...SAMPLES, state });
    if (filled.length > MAX_FILLED) out.push(`${filled.length} characters filled (max ${MAX_FILLED})`);
  }
  return out;
}

describe('guidance-reasons: the checkers catch what they claim to (synthetic input)', () => {
  it('flags a missing sentence, a wrong param set, tool words, an ellipsis, an ID subject and a cut sentence', () => {
    expect(problems(undefined, [], [])).toEqual(['no sentence']);
    expect(problems('Confirm it by hand.', ['ref'], [])[0]).toContain('params');
    expect(problems('Build {{ids}}, {{is}} ready.', ['ids', 'is'], [])[0]).toContain('params');
    expect(problems('Build them: they are takeable.', ['ids', 'is'], [])).toEqual(['tool word: takeable']);
    expect(problems('Run /spec-review and confirm.', [], [])).toEqual(['tool word: /spec-']);
    expect(problems('Write the plan…', [], [])).toEqual(['ellipsis', 'no sentence mark at the end']);
    expect(problems('{{ref}} needs your confirmation.', ['ref'], [])).toEqual(['a claim ID is the subject']);
    expect(problems(`Confirm ${'x'.repeat(100)}.`, [], [])[0]).toContain('characters filled');
    expect(problems('Read the spec and confirm it; your review is {{state}}.', ['state'], ['missing'])).toEqual([]);
  });
});

describe('guidance-reasons: every reason key reads as one sentence in en and de', () => {
  it('has reason keys to check, and the guidance golden carries only derived keys whose phrases fill their template', () => {
    expect(GUIDANCE_REASONS.length).toBeGreaterThan(0);
    expect(GOLDEN_ENTRIES.length).toBeGreaterThan(0);
    const byKey = new Map(GUIDANCE_REASONS.map((r) => [r.key, r.template]));
    for (const { reason } of GOLDEN_ENTRIES) {
      if (reason.key === 'phrase') continue;
      const template = byKey.get(reason.key);
      expect(template, `golden key ${reason.key}`).toBeDefined();
      expect(templatePattern(template ?? '').test(reason.phrase), `${reason.key}: ${reason.phrase}`).toBe(true);
    }
  });

  for (const lang of LANGS) {
    const catalogue = CATALOGUES[lang];
    const stateWords = STATE_VALUES.map((v) => at(catalogue, `guidance.value.state.${v}`) ?? '');

    it(`${lang}: the state words exist, plain and without tool words`, () => {
      for (const [i, word] of stateWords.entries()) {
        expect(word, `guidance.value.state.${STATE_VALUES[i]}`).not.toBe('');
        expect(TOOL_WORDS.test(word), `guidance.value.state.${STATE_VALUES[i]}: ${word}`).toBe(false);
      }
    });

    for (const reason of GUIDANCE_REASONS) {
      it(`${lang}: guidance.reason.${reason.key}`, () => {
        expect(problems(at(catalogue, `guidance.reason.${reason.key}`), reason.placeholders, stateWords)).toEqual([]);
      });
    }

    it(`${lang}: no sentence for a key the core never sends`, () => {
      const keys = new Set(GUIDANCE_REASONS.map((r) => `guidance.reason.${r.key}`));
      const reasonNode = (catalogue['guidance'] as Nested | undefined)?.['reason'];
      expect(leaves(reasonNode, 'guidance.reason').filter((k) => !keys.has(k))).toEqual([]);
    });
  }
});

describe('guidance-reasons: the waits block labels', () => {
  const LABELS: Readonly<Record<string, readonly string[]>> = {
    'guidance.waits.label': [],
    'guidance.waits.empty': [],
    'guidance.waits.more': ['n'],
    'guidance.waits.since': ['time'],
    'guidance.next.label': [],
    'guidance.marker': [],
  };

  for (const lang of LANGS) {
    it(`${lang}: every label exists with its params`, () => {
      for (const [key, expected] of Object.entries(LABELS)) {
        const value = at(CATALOGUES[lang], key);
        expect(value, key).toBeTruthy();
        expect(params(value ?? ''), key).toEqual([...expected]);
        expect(ELLIPSIS.test(value ?? ''), key).toBe(false);
      }
    });
  }

  it('the German label and marker never say "wartet" (spec 040 names the waiting state with it)', () => {
    for (const key of ['guidance.waits.label', 'guidance.marker']) {
      expect(at(CATALOGUES.de, key) ?? '', key).not.toMatch(/wart/i);
    }
  });

  it('en names it "Waits on you" on the label and the marker', () => {
    expect(at(CATALOGUES.en, 'guidance.waits.label')).toBe('Waits on you');
    expect(at(CATALOGUES.en, 'guidance.marker')).toBe('Waits on you');
  });

  it('de holds exactly the en key set under guidance', () => {
    expect(leaves(CATALOGUES.de['guidance'], 'guidance').sort()).toEqual(leaves(CATALOGUES.en['guidance'], 'guidance').sort());
  });
});
