#!/usr/bin/env bun
/**
 * gen-glossary-i18n — ISC-116.1: derives the glossary entries of the two UI catalogues from the core export.
 *
 * Usage: bun scripts/gen-glossary-i18n.ts          (rewrites web/src/i18n/en.json and de.json in place)
 *        bun scripts/gen-glossary-i18n.ts --check  (writes nothing; exit 1 when either file would change)
 *
 * From `GLOSSARY` (`core/src/glossary.ts`) it writes, one group per row keyed by the term's slug:
 *
 *   - `en.json` `glossary.<slug>`: `term`, `common` and `definition`, verbatim from the row;
 *   - `de.json` `glossary.<slug>.term`: the row's `german`. The German `common` and `definition` are hand-written
 *     translations kept as they stand in `de.json`; a missing one is a problem and nothing is written;
 *   - `terms.<slug>`, the common-term hints of ISC-107, for every slug of `TERM_HINTS`: EN `<common> in a ticket
 *     tracker`, DE `<German common> im Ticket-Tracker`.
 *
 * Every other key of both catalogues is kept, in place and in order; the `glossary` group sits right after `terms`.
 * `web/tests/glossary-parity.test.ts` imports `generate()` and compares its output with the committed files byte for
 * byte, so the EN rows can only change through `core/src/glossary.ts` and this script.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLOSSARY } from '../core/src/glossary.ts';

const I18N = join(import.meta.dir, '..', 'web', 'src', 'i18n');

/** The glossary rows that carry a `terms.*` hint: the levels of ISC-107, plus Stage and Actor for the board. */
export const TERM_HINTS = ['feature', 'spec', 'claim', 'task', 'milestone', 'stage', 'actor'] as const;

const EN_HINT = ' in a ticket tracker';
const DE_HINT = ' im Ticket-Tracker';

type Json = Record<string, unknown>;

/** The catalogue key of a term: lower case, any run of other characters one hyphen. */
export const slugOf = (term: string): string => term.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const objectAt = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};

/** `catalogue` with `key` set to `value` right after the key `after` (at the end when `after` is absent). */
function placeAfter(catalogue: Json, key: string, value: unknown, after: string): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(catalogue)) {
    if (k === key) continue;
    out[k] = v;
    if (k === after) out[key] = value;
  }
  if (!Object.hasOwn(out, key)) out[key] = value;
  return out;
}

const serialise = (catalogue: Json): string => `${JSON.stringify(catalogue, null, 2)}\n`;

/** The two catalogues with their glossary entries derived; `problems` names every missing German translation. */
export function generate(enText: string, deText: string): { en: string; de: string; problems: string[] } {
  let en = objectAt(JSON.parse(enText));
  let de = objectAt(JSON.parse(deText));
  const problems: string[] = [];
  const deGlossary = objectAt(de.glossary);

  const enRows: Json = {};
  const deRows: Json = {};
  for (const row of GLOSSARY) {
    const slug = slugOf(row.term);
    enRows[slug] = { term: row.term, common: row.common, definition: row.definition };
    const old = objectAt(deGlossary[slug]);
    const entry: Json = { term: row.german };
    for (const field of ['common', 'definition'] as const) {
      const text = old[field];
      if (typeof text === 'string' && text.trim() !== '') entry[field] = text;
      else problems.push(`de.json: glossary.${slug}.${field} needs a German translation`);
    }
    deRows[slug] = entry;
  }

  const enTerms: Json = {};
  const deTerms: Json = {};
  for (const slug of TERM_HINTS) {
    const row = GLOSSARY.find((r) => slugOf(r.term) === slug);
    if (!row) {
      problems.push(`TERM_HINTS: ${slug} names no glossary row`);
      continue;
    }
    enTerms[slug] = `${row.common}${EN_HINT}`;
    const deCommon = objectAt(deRows[slug]).common;
    if (typeof deCommon === 'string') deTerms[slug] = `${deCommon}${DE_HINT}`;
  }

  en = placeAfter({ ...en, terms: enTerms }, 'glossary', enRows, 'terms');
  de = placeAfter({ ...de, terms: deTerms }, 'glossary', deRows, 'terms');
  return { en: serialise(en), de: serialise(de), problems };
}

if (import.meta.main) {
  const enPath = join(I18N, 'en.json');
  const dePath = join(I18N, 'de.json');
  const enText = readFileSync(enPath, 'utf8');
  const deText = readFileSync(dePath, 'utf8');
  const out = generate(enText, deText);
  if (out.problems.length > 0) {
    for (const problem of out.problems) console.error(`gen-glossary-i18n: ${problem}`);
    process.exit(1);
  }
  const changed = [out.en !== enText ? 'en.json' : '', out.de !== deText ? 'de.json' : ''].filter(Boolean);
  if (process.argv.includes('--check')) {
    if (changed.length > 0) {
      console.error(`gen-glossary-i18n: ${changed.join(', ')} out of date; run bun scripts/gen-glossary-i18n.ts`);
      process.exit(1);
    }
    console.log('gen-glossary-i18n: catalogues up to date');
  } else {
    writeFileSync(enPath, out.en);
    writeFileSync(dePath, out.de);
    console.log(`gen-glossary-i18n: ${GLOSSARY.length} rows, ${TERM_HINTS.length} hints${changed.length ? `; wrote ${changed.join(', ')}` : '; nothing changed'}`);
  }
}
