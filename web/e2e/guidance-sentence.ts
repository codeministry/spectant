/**
 * Spec 020 (T13, ISC-237.1): the sentence a guidance entry's reason reads in the English catalogue, built from
 * `web/src/i18n/en.json` by key (`guidance.reason.<key>`, each value as its `guidance.value.<placeholder>.<value>` word
 * where the catalogue has one), never re-typed in a spec. A missing key, and the key `phrase`, read the core's phrase,
 * as the `guidanceReason` pipe does.
 */
import { readFileSync } from 'node:fs';

/** The fields of core's `GuidanceReason` and `GuidanceEntry` read here (structural, as the other e2e specs do). */
export type GuidanceReasonView = { readonly key: string; readonly values: Readonly<Record<string, string>>; readonly phrase: string };
export type GuidanceEntryView = { readonly spec: string; readonly item: string; readonly reason: GuidanceReasonView };
export type GuidanceView = { readonly waits: readonly GuidanceEntryView[]; readonly next: readonly GuidanceEntryView[] };

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const EN = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as unknown;

/** The catalogue string at a dotted path, the dots read as nesting; undefined when there is none. */
function lookup(path: string): string | undefined {
  let node: unknown = EN;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** The English sentence of a reason. */
export function sentenceOf(reason: GuidanceReasonView): string {
  const template = reason.key === 'phrase' ? undefined : lookup(`guidance.reason.${reason.key}`);
  if (template === undefined) return reason.phrase;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/gu, (_, name: string) => {
    const value = reason.values[name] ?? '';
    return lookup(`guidance.value.${name}.${value}`) ?? value;
  });
}

/** The spec's own entry (`item: 'spec'`) in `waits` ∪ `next`; undefined when the guidance names none. */
export function specEntryOf(guidance: GuidanceView | undefined, spec: string): GuidanceEntryView | undefined {
  return [...(guidance?.waits ?? []), ...(guidance?.next ?? [])].find((e) => e.spec === spec && e.item === 'spec');
}

/** What a surface shows for a spec: its entry's sentence, or `phrase` when the guidance names no entry for it. */
export function shownReason(guidance: GuidanceView | undefined, spec: string, phrase: string): string {
  const entry = specEntryOf(guidance, spec);
  return entry ? sentenceOf(entry.reason) : phrase;
}
