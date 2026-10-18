import { CATALOGUES, LANGS } from '../../i18n/catalogues';

// Plural guard for the catalogues (spec 021, ISC-253). A count text is a value whose `{{count}}` quantifies the word
// (or the interpolated word) right after it in the English catalogue: `{{count}} cards`, `{{count}} {{type}}`. Such a
// text inflects with the count, so in every catalogue it must be a plural object holding `one` and `other` (a `none`
// form and a non-form key such as `word` may sit beside them); the caller picks the form by the count, as
// `planning.page.eyebrowCount` does. A label that only shows a number (`Specs: {{count}}`, `+{{count}}`,
// `Notes {{count}}`) does not inflect and is not a count text. The English word order decides, because German puts
// the verb after the count (`Alle {{count}} anzeigen`) where English has none (`Show all {{count}}`).

/** The plural forms whose presence makes an object a plural object. */
const PLURAL_FORMS: ReadonlySet<string> = new Set(['none', 'zero', 'one', 'two', 'few', 'many', 'other']);
/** `{{count}}` followed by a word or another interpolation: the count quantifies it. */
const COUNT_TEXT = /\{\{count\}\}\s+(?:\p{L}|\{\{)/u;

/** One catalogue key: a plain text, or a plural object with whether it holds both `one` and `other`. */
type Entry = { readonly kind: 'text'; readonly value: string } | { readonly kind: 'plural'; readonly complete: boolean };

const isObject = (node: unknown): node is Record<string, unknown> =>
  node !== null && typeof node === 'object' && !Array.isArray(node);

/** Every key of `catalogue` as text or plural object; the forms inside a plural object are not keys of their own. */
function entries(catalogue: unknown): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const walk = (node: unknown, path: readonly string[]): void => {
    if (typeof node === 'string') {
      out.set(path.join('.'), { kind: 'text', value: node });
      return;
    }
    if (!isObject(node)) return;
    const plural = 'one' in node || 'other' in node;
    if (plural) out.set(path.join('.'), { kind: 'plural', complete: 'one' in node && 'other' in node });
    for (const [key, child] of Object.entries(node)) {
      if (!(plural && PLURAL_FORMS.has(key))) walk(child, [...path, key]);
    }
  };
  walk(catalogue, []);
  return out;
}

/**
 * Per catalogue, the sorted dotted keys of every count text that is not a plural object with both `one` and `other`.
 * A key is a count text when `reference`'s value is a text matching `COUNT_TEXT`, or when any catalogue holds it as a
 * plural object.
 */
export function countTextsWithoutPlural(catalogues: Readonly<Record<string, unknown>>, reference: string): Record<string, string[]> {
  const all = Object.fromEntries(Object.entries(catalogues).map(([lang, catalogue]) => [lang, entries(catalogue)]));
  const countKeys = new Set<string>();
  for (const [key, entry] of all[reference] ?? new Map<string, Entry>()) {
    if (entry.kind === 'text' && COUNT_TEXT.test(entry.value)) countKeys.add(key);
  }
  for (const map of Object.values(all)) {
    for (const [key, entry] of map) if (entry.kind === 'plural') countKeys.add(key);
  }
  return Object.fromEntries(
    Object.entries(all).map(([lang, map]) => {
      const offenders = [...countKeys].filter((key) => {
        const entry = map.get(key);
        return entry === undefined || entry.kind === 'text' || !entry.complete;
      });
      return [lang, offenders.sort()];
    }),
  );
}

describe('catalog plurals', () => {
  describe('the checker on synthetic input', () => {
    it('flags bare count texts and incomplete plural objects in every catalogue, and nothing else', () => {
      const en = {
        bare: '{{count}} cards',
        interpolated: '{{count}} {{type}} · {{archived}} archived',
        nested: { inner: 'Shares {{count}} files with' },
        onlyOther: { other: '{{count}} milestones' },
        complete: { one: '{{count}} note', other: '{{count}} notes' },
        withExtras: { word: 'missing', none: 'No notes', one: '{{count}} note', other: '{{count}} notes' },
        germanHalf: { one: '{{count}} spec', other: '{{count}} specs' },
        label: 'Specs: {{count}}',
        trailing: 'Notes {{count}}',
        more: '+{{count}}',
        showAll: 'Show all {{count}}',
        noCount: '3 cards',
      };
      const de = {
        ...en,
        complete: { one: '{{count}} Notiz', other: '{{count}} Notizen' },
        germanHalf: '{{count}} Specs',
        showAll: 'Alle {{count}} anzeigen',
      };
      expect(countTextsWithoutPlural({ en, de }, 'en')).toEqual({
        en: ['bare', 'interpolated', 'nested.inner', 'onlyOther'],
        de: ['bare', 'germanHalf', 'interpolated', 'nested.inner', 'onlyOther'],
      });
    });

    it('finds nothing in catalogues without count texts', () => {
      const plain = { a: 'Title', b: { c: 'Show all {{count}}' } };
      expect(countTextsWithoutPlural({ en: plain, de: plain }, 'en')).toEqual({ en: [], de: [] });
    });
  });

  const offenders = countTextsWithoutPlural(CATALOGUES, 'en');
  for (const lang of LANGS) {
    it(`every count text in ${lang}.json has the forms one and other`, () => {
      const keys = offenders[lang];
      expect(keys, `${lang}.json: ${keys.length} count texts without one/other:\n  ${keys.join('\n  ')}`).toEqual([]);
    });
  }
});
