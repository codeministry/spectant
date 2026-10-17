// Glossary parity guard for ISC-116.1 (T141): the catalogues name a term the way the glossary row of the core export
// (`GLOSSARY`, `core/src/glossary.ts`) names it, in English and in German, so the meaning of a term has one source.
//
// The checks, each on its own so a failure names the broken rule:
//   1. `glossary.*` holds exactly one group per glossary row, keyed by the term's slug, in both catalogues, and no
//      extra one. EN carries `term`, `common` and `definition` verbatim from the row; DE carries the row's `german` as
//      `term` and hand-written `common` and `definition`, whose code spans (`…`) equal the EN definition's.
//   2. Every `terms.*` hint (ISC-107) belongs to a glossary row and is derived from its common term:
//      EN `<common> in a ticket tracker`, DE `<German common> im Ticket-Tracker`.
//   3. Every catalogue entry that is a level label (its EN value is a glossary term or its plural, any case) reads
//      the glossary's German term (or its plural) in DE. The five item-state rows (spec 040) are not level labels:
//      their EN words also name a stage (`done`) or a board column (`waiting`), so rule 3 skips them.
//   4. No German value uses an English level word the glossary translates (Milestone, Idea, Actor) or a drift synonym
//      for a level (Stufe for Stage, Aufgabe for Task). Code spans and quoted `## Heading` literals are exempt.
//   5. No catalogue entry outside `terms.*` and `glossary.*` is a level's common term: the screen says Feature · Spec
//      · Claim · Task · Milestone, the tracker words appear only as hints.
//   6. `scripts/gen-glossary-i18n.ts` reproduces both catalogues byte for byte, so the EN rows stay generated.
//
// The checker functions are proven on synthetic input first, so a green run cannot come from a checker that finds
// nothing. The key parity of the two catalogues stays with `i18n-parity.test.ts`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLOSSARY, type GlossaryRow } from "../../core/src/glossary.ts";
import { generate } from "../../scripts/gen-glossary-i18n.ts";

const I18N = join(import.meta.dir, "..", "src", "i18n");

type Nested = Readonly<Record<string, unknown>>;
type Flat = Map<string, string>;

const EN_HINT = " in a ticket tracker";
const DE_HINT = " im Ticket-Tracker";

/** The levels the screen names (ISC-107): their common terms never stand alone outside a hint. */
const LEVELS = ["feature", "spec", "claim", "task", "milestone"] as const;

/** The item-state rows of the glossary (spec 040, ISC-228): states, not level labels, so rule 3 skips them. */
const STATE_TERMS: ReadonlySet<string> = new Set(["Open", "Waiting", "Running", "Aborted", "Done"]);

/** German plurals of the glossary's German terms; the glossary itself carries the singular only. */
const DE_PLURAL: Readonly<Record<string, string>> = {
  Feature: "Features",
  Spec: "Specs",
  Claim: "Claims",
  Task: "Tasks",
  Meilenstein: "Meilensteine",
  Idee: "Ideen",
  Stage: "Stages",
  Workflow: "Workflows",
  Gate: "Gates",
  Probe: "Probes",
  Akteur: "Akteure",
  Agent: "Agenten",
  Chore: "Chores",
};

/** Words a German value must not use: English terms the glossary translates, and drift synonyms of a level. */
const DE_BANNED = ["Milestones?", "Ideas?", "Actors?", "Stufen?", "Aufgaben?"];

const slugOf = (term: string) => term.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function flatten(value: unknown, prefix = "", out: Flat = new Map()): Flat {
  if (typeof value === "string") out.set(prefix, value);
  else if (value !== null && typeof value === "object")
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

const group = (catalogue: Nested, key: string): Nested => {
  const value = catalogue[key];
  return value !== null && typeof value === "object" ? (value as Nested) : {};
};

/** The code spans of a value, in order: `### F<n>`, `specs/ideas/`. */
const codeSpans = (value: string) => [...value.matchAll(/`[^`]*`/g)].map((m) => m[0]);

/** Rule 1: the `glossary.*` groups against the rows. */
function glossaryProblems(en: Nested, de: Nested, rows: readonly GlossaryRow[]): string[] {
  const out: string[] = [];
  const want = rows.map((row) => slugOf(row.term));
  for (const [lang, catalogue] of [["en", en], ["de", de]] as const) {
    const have = Object.keys(group(catalogue, "glossary"));
    if (have.join() !== want.join()) out.push(`${lang}: glossary groups [${have.join()}], want [${want.join()}]`);
  }
  for (const row of rows) {
    const slug = slugOf(row.term);
    const e = group(group(en, "glossary"), slug);
    const d = group(group(de, "glossary"), slug);
    for (const [lang, entry] of [["en", e], ["de", d]] as const) {
      const fields = Object.keys(entry).sort().join();
      if (fields !== "common,definition,term") out.push(`${lang}: glossary.${slug} fields [${fields}]`);
    }
    for (const field of ["term", "common", "definition"] as const)
      if (e[field] !== row[field]) out.push(`en: glossary.${slug}.${field} is ${JSON.stringify(e[field])}, row says ${JSON.stringify(row[field])}`);
    if (d.term !== row.german) out.push(`de: glossary.${slug}.term is ${JSON.stringify(d.term)}, row says ${JSON.stringify(row.german)}`);
    for (const field of ["common", "definition"] as const)
      if (typeof d[field] !== "string" || d[field].trim() === "") out.push(`de: glossary.${slug}.${field} is missing`);
    const deDefinition = typeof d.definition === "string" ? d.definition : "";
    if (codeSpans(deDefinition).join(" ") !== codeSpans(row.definition).join(" "))
      out.push(`de: glossary.${slug}.definition code spans [${codeSpans(deDefinition).join(" ")}], row has [${codeSpans(row.definition).join(" ")}]`);
  }
  return out;
}

/** Rule 2: every `terms.*` hint is derived from its glossary row's common term. */
function hintProblems(en: Nested, de: Nested, rows: readonly GlossaryRow[]): string[] {
  const out: string[] = [];
  const bySlug = new Map(rows.map((row) => [slugOf(row.term), row]));
  for (const [lang, catalogue] of [["en", en], ["de", de]] as const) {
    for (const [slug, hint] of Object.entries(group(catalogue, "terms"))) {
      const row = bySlug.get(slug);
      if (!row) {
        out.push(`${lang}: terms.${slug} has no glossary row`);
        continue;
      }
      const deCommon = group(group(de, "glossary"), slug).common;
      const want = lang === "en" ? `${row.common}${EN_HINT}` : `${String(deCommon)}${DE_HINT}`;
      if (hint !== want) out.push(`${lang}: terms.${slug} is ${JSON.stringify(hint)}, want ${JSON.stringify(want)}`);
    }
  }
  return out;
}

const outsideGlossary = (key: string) => !key.startsWith("glossary.") && !key.startsWith("terms.");

/** Rule 3: a level label reads the glossary's German term in DE. */
function levelLabelProblems(en: Flat, de: Flat, rows: readonly GlossaryRow[]): string[] {
  const out: string[] = [];
  for (const [key, value] of en) {
    if (!outsideGlossary(key)) continue;
    const word = value.trim().toLowerCase();
    for (const row of rows) {
      const term = row.term.toLowerCase();
      if (word !== term && word !== `${term}s`) continue;
      const want = word === term ? row.german : (DE_PLURAL[row.german] ?? `${row.german}s`);
      if (de.get(key) !== want) out.push(`de: ${key} is ${JSON.stringify(de.get(key))}, the glossary says ${JSON.stringify(want)}`);
    }
  }
  return out;
}

const WORD = "[\\p{L}\\p{N}_]";
const BANNED = new RegExp(`(?<!${WORD})(?:${DE_BANNED.join("|")})(?!${WORD})`, "gu");

/** Rule 4: English level words and drift synonyms in German values; code spans and `## Heading` literals exempt. */
function deWordProblems(de: Flat): string[] {
  return [...de].flatMap(([key, value]) => {
    if (key.endsWith(".common") && key.startsWith("glossary.")) return [];
    const prose = value.replace(/`[^`]*`/g, "").replace(/## [\p{L}]+/gu, "");
    return [...prose.matchAll(BANNED)].map((m) => `de: ${key} uses "${m[0]}"`);
  });
}

/** Rule 5: a level's common term never stands alone as a catalogue value outside the hints and the glossary. */
function commonLeakProblems(lang: string, flat: Flat, commons: readonly string[]): string[] {
  const words = new Set(commons.map((c) => c.toLowerCase()));
  return [...flat]
    .filter(([key, value]) => outsideGlossary(key) && words.has(value.trim().toLowerCase()))
    .map(([key, value]) => `${lang}: ${key} is the tracker word ${JSON.stringify(value)}`);
}

const ROW = (term: string, common: string, german: string, definition: string): GlossaryRow => ({ term, common, german, definition });

describe("the checkers catch what they claim to (synthetic input)", () => {
  const rows = [ROW("Feature", "Epic", "Feature", "A block `### F<n>`."), ROW("Milestone", "Fix version", "Meilenstein", "A release.")];
  const en = {
    glossary: {
      feature: { term: "Feature", common: "Epic", definition: "A block `### F<n>`." },
      milestone: { term: "Milestone", common: "Fix version", definition: "A release." },
    },
    terms: { feature: "Epic in a ticket tracker" },
  };
  const de = {
    glossary: {
      feature: { term: "Feature", common: "Epic", definition: "Ein Block `### F<n>`." },
      milestone: { term: "Meilenstein", common: "Lösungsversion", definition: "Ein Release." },
    },
    terms: { feature: "Epic im Ticket-Tracker" },
  };

  test("a faithful catalogue pair passes every rule", () => {
    expect(glossaryProblems(en, de, rows)).toEqual([]);
    expect(hintProblems(en, de, rows)).toEqual([]);
  });

  test("a missing, extra or reordered glossary group is found", () => {
    const short = { glossary: { feature: en.glossary.feature } };
    expect(glossaryProblems(short, de, rows)).toContain("en: glossary groups [feature], want [feature,milestone]");
    const extra = { glossary: { ...de.glossary, epic: { term: "x", common: "x", definition: "x" } } };
    expect(glossaryProblems(en, extra, rows)[0]).toStartWith("de: glossary groups");
    const reordered = { glossary: { milestone: en.glossary.milestone, feature: en.glossary.feature } };
    expect(glossaryProblems(reordered, de, rows)[0]).toStartWith("en: glossary groups");
  });

  test("an EN cell that drifts from the row, a DE term that is not `german`, and lost code spans are found", () => {
    const drift = { glossary: { ...en.glossary, feature: { ...en.glossary.feature, definition: "A block." } } };
    const driftProblems = glossaryProblems(drift, de, rows);
    expect(driftProblems).toHaveLength(1);
    expect(driftProblems[0]).toStartWith("en: glossary.feature.definition");
    const deDrift = {
      glossary: {
        feature: { ...de.glossary.feature, definition: "Ein Block F<n>." },
        milestone: { ...de.glossary.milestone, term: "Milestone" },
      },
    };
    const problems = glossaryProblems(en, deDrift, rows);
    expect(problems).toContain('de: glossary.milestone.term is "Milestone", row says "Meilenstein"');
    expect(problems.some((p) => p.startsWith("de: glossary.feature.definition code spans"))).toBe(true);
  });

  test("a hint that is not derived from its row, or names no row, is found", () => {
    expect(hintProblems({ terms: { feature: "Epic in Jira" } }, de, rows)).toEqual([
      'en: terms.feature is "Epic in Jira", want "Epic in a ticket tracker"',
    ]);
    expect(hintProblems(en, { ...de, terms: { feature: "Epos im Ticket-Tracker" } }, rows)).toHaveLength(1);
    expect(hintProblems({ terms: { epic: "Epic" } }, de, rows)).toEqual(["en: terms.epic has no glossary row"]);
  });

  test("a level label that is not the German glossary term is found, singular and plural, any EN case", () => {
    const enFlat = flatten({ a: "Milestones", b: "feature", c: "Milestone", d: "Features of {{ws}}" });
    const deFlat = flatten({ a: "Milestones", b: "Feature", c: "Meilenstein", d: "Features von {{ws}}" });
    expect(levelLabelProblems(enFlat, deFlat, rows)).toEqual(['de: a is "Milestones", the glossary says "Meilensteine"']);
  });

  test("English level words and drift synonyms in German are found; code spans and headings are exempt", () => {
    const deFlat = flatten({
      a: "Keine Milestones",
      b: "Stufe 2 von 3",
      c: "diese Aufgabe",
      d: "nicht im Block ## Milestones des Masters",
      e: "Eine Datei unter `specs/ideas/`",
      f: "Die Meilensteine und Ideen",
      g: "Milestones-Seite",
    });
    expect(deWordProblems(deFlat)).toEqual([
      'de: a uses "Milestones"',
      'de: b uses "Stufe"',
      'de: c uses "Aufgabe"',
      'de: g uses "Milestones"',
    ]);
  });

  test("a tracker word standing alone outside the hints is found", () => {
    const flat = flatten({ a: "Epic", b: "Epics and stories", terms: { feature: "Epic" }, glossary: { feature: { common: "Epic" } } });
    expect(commonLeakProblems("en", flat, ["Epic"])).toEqual(['en: a is the tracker word "Epic"']);
  });
});

describe("the catalogues against the core glossary (ISC-116.1)", () => {
  const read = (lang: string) => readFileSync(join(I18N, `${lang}.json`), "utf8");
  const en = JSON.parse(read("en")) as Nested;
  const de = JSON.parse(read("de")) as Nested;
  const enFlat = flatten(en);
  const deFlat = flatten(de);

  test("the core export holds eighteen rows with distinct slugs", () => {
    expect(GLOSSARY).toHaveLength(18);
    expect(new Set(GLOSSARY.map((row) => slugOf(row.term))).size).toBe(18);
  });

  test("glossary.* holds the eighteen rows in both catalogues, EN verbatim, DE with `german` as the term", () => {
    expect(glossaryProblems(en, de, GLOSSARY)).toEqual([]);
  });

  test("every terms.* hint is derived from its glossary row in EN and DE", () => {
    expect(Object.keys(group(en, "terms")).length).toBeGreaterThanOrEqual(4);
    expect(hintProblems(en, de, GLOSSARY)).toEqual([]);
  });

  test("every level label reads the glossary's German term in DE", () => {
    const levelRows = GLOSSARY.filter((row) => !STATE_TERMS.has(row.term));
    expect(levelRows).toHaveLength(GLOSSARY.length - STATE_TERMS.size);
    expect(levelLabelProblems(enFlat, deFlat, levelRows)).toEqual([]);
  });

  test("no German value uses an English level word or a drift synonym", () => {
    expect(deWordProblems(deFlat)).toEqual([]);
  });

  test("no level's tracker word stands alone outside the hints", () => {
    const rows = GLOSSARY.filter((row) => (LEVELS as readonly string[]).includes(slugOf(row.term)));
    expect(rows).toHaveLength(LEVELS.length);
    expect(commonLeakProblems("en", enFlat, rows.map((row) => row.common))).toEqual([]);
    const deCommons = rows.map((row) => String(group(group(de, "glossary"), slugOf(row.term)).common));
    expect(commonLeakProblems("de", deFlat, deCommons)).toEqual([]);
  });

  test("scripts/gen-glossary-i18n.ts reproduces both catalogues byte for byte", () => {
    const out = generate(read("en"), read("de"));
    expect(out.problems).toEqual([]);
    expect(out.en).toBe(read("en"));
    expect(out.de).toBe(read("de"));
  });
});
