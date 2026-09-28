// i18n parity guard for ISC-22 (T23): every UI string key exists in both the English and the German catalogue, and
// the German catalogue addresses the reader formally ("Sie"), never with "du" / "dein" / a second-person verb.
//
// The checks, each on its own so a failure names the broken rule:
//   1. `web/src/i18n/` holds exactly `en.json` and `de.json`; a third catalogue would skip this guard.
//   2. Both are nested objects whose leaves are strings only (no arrays, numbers or nulls a pipe would render oddly).
//   3. The flattened key sets are equal: no key missing on either side.
//   4. No value is empty or whitespace only.
//   5. Every key carries the same Transloco params (`{{count}}`) in both languages.
//   6. No German value holds an informal form (case-insensitive, Unicode word boundaries, so "Dusche" or "Dienst"
//      never trip it).
//   7. Every key a source under `web/src` passes to the `transloco` pipe exists in the catalogues.
//
// The checker functions are proven on synthetic input first, so a green run cannot come from a checker that finds
// nothing.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = join(import.meta.dir, "..");
const SRC = join(WEB, "src");
const I18N = join(SRC, "i18n");
const LANGS = ["en", "de"] as const;

type Catalogue = Map<string, string>;

/** Flatten a nested catalogue to dotted keys; a non-string leaf is reported as a problem, not silently dropped. */
function flatten(value: unknown, prefix = "", out: Catalogue = new Map(), problems: string[] = []) {
  if (typeof value === "string") {
    out.set(prefix, value);
  } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out, problems);
  } else {
    problems.push(`${prefix || "<root>"}: leaf is ${Array.isArray(value) ? "an array" : String(value)}, not a string`);
  }
  return { keys: out, problems };
}

/** Keys present in `a` and absent from `b`, sorted. */
const missing = (a: Catalogue, b: Catalogue) => [...a.keys()].filter((key) => !b.has(key)).sort();

/** Keys whose value is empty or whitespace only. */
const empty = (catalogue: Catalogue) =>
  [...catalogue].filter(([, value]) => value.trim() === "").map(([key]) => key);

/** Transloco param names in one value: `{{count}}`, `{{ name }}`. */
const params = (value: string) =>
  [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1] ?? "").sort();

/** Keys present in both catalogues whose param sets differ. */
function paramMismatches(a: Catalogue, b: Catalogue): string[] {
  const out: string[] = [];
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other === undefined) continue;
    const left = [...new Set(params(value))].join(",");
    const right = [...new Set(params(other))].join(",");
    if (left !== right) out.push(`${key}: {${left}} vs {${right}}`);
  }
  return out;
}

// Informal German. `\b` in JavaScript is ASCII-only, so boundaries are spelled as "no letter, digit or underscore"
// with the `u` flag: "Dusche", "Dienst", "Bedürfnis" and "Direktor" never match.
const WORD = "[\\p{L}\\p{N}_]";
const INFORMAL_WORDS = [
  "du",
  "dein(?:e|en|em|er|es)?",
  "dich",
  "dir",
  // Second-person verb endings, limited to a denylist: a general `\w+st` would hit "fast", "Test", "Dienst".
  "kannst|musst|willst|hast|bist|sollst|gehst|siehst|klickst|wählst",
];
const INFORMAL = new RegExp(`(?<!${WORD})(?:${INFORMAL_WORDS.join("|")})(?!${WORD})`, "giu");

/** Informal forms found in one string. */
const informal = (value: string) => [...value.matchAll(INFORMAL)].map((m) => m[0]);

/** `key: form` for every informal form in a catalogue. */
const informalHits = (catalogue: Catalogue) =>
  [...catalogue].flatMap(([key, value]) => informal(value).map((form) => `${key}: "${form}"`));

/** Keys passed literally to the `transloco` pipe: `'hello.title' | transloco`, `"a.b" | transloco: {…}`. */
const pipeKeys = (text: string) =>
  [...text.matchAll(/(['"])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1\s*\|\s*transloco\b/g)].map((m) => m[2] ?? "");

const load = (lang: string) => {
  const raw = JSON.parse(readFileSync(join(I18N, `${lang}.json`), "utf8")) as unknown;
  return flatten(raw);
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(ts|html)$/.test(e.name) && !e.name.endsWith(".spec.ts"))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

describe("the checkers catch what they claim to (synthetic input)", () => {
  test("flatten reports non-string leaves", () => {
    const { keys, problems } = flatten({ a: { b: "x", c: 1, d: ["y"], e: null } });
    expect([...keys.keys()]).toEqual(["a.b"]);
    expect(problems).toHaveLength(3);
  });

  test("missing keys are found on either side", () => {
    const en = flatten({ a: "A", b: { c: "C", d: "D" } }).keys;
    const de = flatten({ a: "A", b: { c: "C" }, e: "E" }).keys;
    expect(missing(en, de)).toEqual(["b.d"]);
    expect(missing(de, en)).toEqual(["e"]);
  });

  test("empty and whitespace-only values are found", () => {
    expect(empty(flatten({ a: "", b: "  ", c: "ok" }).keys)).toEqual(["a", "b"]);
  });

  test("a param present in one language only is found", () => {
    const en = flatten({ a: "{{count}} specs", b: "{{ n }} of {{m}}", c: "none" }).keys;
    const de = flatten({ a: "Specs", b: "{{m}} / {{n}}", c: "{{x}} keine" }).keys;
    expect(paramMismatches(en, de)).toEqual(["a: {count} vs {}", "c: {} vs {x}"]);
  });

  test("informal German is flagged, case-insensitive", () => {
    for (const bad of [
      "Kannst du das sehen?",
      "Dein Workspace",
      "Wähle deine Sprache",
      "Das zeigen wir dir",
      "Wir melden uns bei dich",
      "Du hast keine Specs",
      "Bist fertig",
      "DU MUSST neu laden",
      "Hier siehst alles",
      "Wählst eine Sprache",
      "Klickst auf Retry",
      "Deinem Repo fehlt nichts",
    ]) {
      expect(informal(bad).length).toBeGreaterThan(0);
    }
  });

  test("formal German and look-alike words pass", () => {
    for (const good of [
      "Können Sie das sehen?",
      "Ihr Workspace",
      "Wählen Sie Ihre Sprache",
      "Dusche, Dienst, Direktor, Durchsuchen, Bedürfnis",
      "Fast fertig · Test bestanden",
      "Dubai hat Dünen",
      "Verzeichnis des Repos",
    ]) {
      expect(informal(good)).toEqual([]);
    }
  });

  test("pipe keys are extracted from templates", () => {
    const tpl = `<h1>{{ 'hello.title' | transloco }}</h1> <p [title]='"a.b-c" | transloco: { n: 1 }'></p> {{ plain }}`;
    expect(pipeKeys(tpl)).toEqual(["hello.title", "a.b-c"]);
  });
});

describe("web/src/i18n catalogues (ISC-22)", () => {
  test("en.json and de.json are the only catalogues", () => {
    const files = readdirSync(I18N).filter((name) => name.endsWith(".json")).sort();
    expect(files).toEqual(["de.json", "en.json"]);
  });

  for (const lang of LANGS) {
    test(`${lang}.json is nested objects with string leaves only`, () => {
      expect(load(lang).problems).toEqual([]);
    });

    test(`${lang}.json has no empty value`, () => {
      expect(empty(load(lang).keys)).toEqual([]);
    });
  }

  test("no key is missing in de.json", () => {
    expect(missing(load("en").keys, load("de").keys)).toEqual([]);
  });

  test("no key is missing in en.json", () => {
    expect(missing(load("de").keys, load("en").keys)).toEqual([]);
  });

  test("every key carries the same params in both languages", () => {
    expect(paramMismatches(load("en").keys, load("de").keys)).toEqual([]);
  });

  test("de.json addresses the reader formally", () => {
    expect(informalHits(load("de").keys)).toEqual([]);
  });

  test("every key passed to the transloco pipe under web/src exists", () => {
    const en = load("en").keys;
    const unknown = sourceFiles(SRC).flatMap((path) =>
      pipeKeys(readFileSync(path, "utf8"))
        .filter((key) => !en.has(key))
        .map((key) => `${relative(SRC, path)}: ${key}`),
    );
    expect(unknown).toEqual([]);
  });
});
