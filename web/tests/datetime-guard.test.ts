// Date and time guard for ISC-114.2 (spec 006, T16): every date or time the app shows goes through the shared
// formatter in `web/src/app/shared/time/`; a component that formats one itself is a defect. This guard reads every
// `.ts` and `.html` file under `web/src/app`, except `shared/time/` (the formatter itself) and `*.spec.ts` (specs paint
// nothing), and fails on each line that:
//
// - builds its own `Intl.DateTimeFormat` (or names its options type);
// - calls `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString`, or `toDateString` / `toTimeString` /
//   `toUTCString`;
// - cuts an ISO string down to a day or a minute (`toISOString().slice(…)`, `.slice(0, 10|16|19)`, `.split('T')`);
// - reads a date part, `getFullYear` / `getMonth` / `getDate` / `getDay` / `getHours` / `getMinutes` / `getSeconds`
//   or their `getUTC*` twins, to build a display value;
// - glues an hour and a minute together by hand (`${hours}:${minutes}`);
// - uses Angular's `date` pipe or `DatePipe`;
// - interpolates a raw calendar-day field, the milestone `target`, straight into a template or a template literal
//   (it renders through `<ui-time form="day">` instead, ISC-114.3).
//
// Relative times stay allowed and match none of these: `Intl.RelativeTimeFormat`, `Intl.ListFormat`, `ui-relative-time`,
// `relativeTime` / `elapsedLabel`, `ago()`, and `toISOString()` used whole for an attribute or a key. A legitimate
// non-display use of a pattern goes into ALLOW with its reason, never as a directory exclusion.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const APP = join(SRC, "app");
const FORMATTER = "app/shared/time/";

/** Every `.ts` and `.html` file under `web/src/app`, specs excluded, sorted so the hit list reads in a stable order. */
function sources(dir = APP): string[] {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|html)$/.test(entry.name) && !entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

type Line = { file: string; line: number; text: string };

/** Code lines only: comment lines (`//`, `/*`, ` *`, `<!--`) are prose and may name a pattern to rule it out. */
const codeLines = (file: string, source: string): Line[] =>
  source
    .split("\n")
    .map((text, i) => ({ file, line: i + 1, text }))
    .filter(({ text }) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(text));

const ALL: Line[] = sources().flatMap((path) => codeLines(relative(SRC, path), readFileSync(path, "utf8")));
const LINES: Line[] = ALL.filter(({ file }) => !file.startsWith(FORMATTER));

/** Each pattern a component must leave to the shared formatter, by the name a hit reports. */
const PATTERNS: ReadonlyArray<readonly [name: string, re: RegExp]> = [
  ["Intl.DateTimeFormat", /\bDateTimeFormat\b/],
  ["toLocale*String", /\.toLocale(?:Date|Time)?String\s*\(/],
  ["Date#to*String", /\.to(?:Date|Time|UTC|GMT)String\s*\(/],
  ["truncated ISO", /toISOString\(\)\s*\.\s*(?:slice|substring|substr|split|replace)\b/],
  ["truncated ISO", /\.(?:slice|substring|substr)\(\s*(?:0\s*,\s*(?:10|16|19)|11\s*,\s*(?:16|19))\s*\)/],
  ["truncated ISO", /\.split\(\s*['"]T['"]\s*\)/],
  ["date-part getter", /\.get(?:UTC)?(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds)\s*\(/],
  ["hand-built clock", /\$\{[^}]*(?:hour|minute)[^}]*\}\s*:\s*\$\{/i],
  ["date pipe", /\|\s*date\b|\bDatePipe\b/],
  ["raw calendar day", /\{\{\s*(?:[\w?!]+\.)*target\b[^}]*\}\}/],
  ["raw calendar day", /\$\{\s*(?:[\w?!]+\.)*target\s*\}/],
];

/** Non-display uses of a pattern, by file and pattern name; keep it short and give every entry its reason. */
const ALLOW: ReadonlyArray<{ file: string; pattern: string; why: string }> = [
  {
    file: "app/features/dashboard/specs-page/specs-page.ts",
    pattern: "raw calendar day",
    why: "`spec:${target}` is a selection key built from a spec id, not a date",
  },
];

/** Every hit as `path:line: <pattern> — <line text>`, one per pattern name and line. */
const hits = (lines: Line[]): string[] =>
  lines.flatMap(({ file, line, text }) =>
    [...new Set(PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name))]
      .filter((name) => !ALLOW.some((a) => a.file === file && a.pattern === name))
      .map((name) => `${file}:${line}: ${name} — ${text.trim()}`),
  );

// The sites the earlier waves of spec 006 already moved onto `shared/time/` (T5–T13); they must stay clean.
const CONVERTED = [
  "app/features/library/library-reader.ts",
  "app/features/library/library-reader.html",
  "app/features/library/library-page.ts",
  "app/features/library/library-page.html",
  "app/layout/spec-head/gate-button/gate-button.ts",
  "app/layout/spec-head/gate-button/gate-button.html",
  "app/features/spec/status/status-block.ts",
  "app/features/spec/status/status-tab.ts",
  "app/features/spec/status/status-tab.html",
  "app/features/spec/status/timeline/timeline-tab.ts",
  "app/features/spec/status/timeline/timeline-tab.html",
];

describe("dates and times go through shared/time (ISC-114.2)", () => {
  test("sources were found, the formatter and the specs left out", () => {
    expect(ALL.some(({ file }) => file.startsWith(FORMATTER))).toBe(true);
    expect(LINES.some(({ file }) => file.startsWith(FORMATTER))).toBe(false);
    expect(LINES.some(({ file }) => file.endsWith(".spec.ts"))).toBe(false);
    expect(LINES.some(({ file }) => file.endsWith(".html"))).toBe(true);
  });

  test("every allowlist entry names a scanned file", () => {
    for (const { file } of ALLOW) expect(LINES.some((l) => l.file === file), file).toBe(true);
  });

  test("the converted sites are scanned and clean", () => {
    for (const file of CONVERTED) {
      const own = LINES.filter((l) => l.file === file);
      expect(own.length, file).toBeGreaterThan(0);
      expect(hits(own), file).toEqual([]);
    }
  });

  test("no component formats a date or a time itself", () => {
    expect(hits(LINES)).toEqual([]);
  });
});

describe("negative: the guard catches each pattern and spares relative times", () => {
  const file = "app/features/x/x.ts";
  const one = (text: string) => hits(codeLines(file, text));

  test("each self-formatting pattern is reported", () => {
    for (const text of [
      "const f = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' });",
      "return at.toLocaleDateString(lang);",
      "return at.toLocaleString();",
      "if (at.toDateString() === now.toDateString()) return '';",
      "const day = new Date(iso).toISOString().slice(0, 10);",
      "const day = iso.slice(0, 10);",
      "const [day] = iso.split('T');",
      "const y = now.getFullYear();",
      "const h = now.getUTCHours();",
      "const clock = `${hours}:${minutes}`;",
      "<span>{{ at | date: 'short' }}</span>",
      '<span class="date">{{ target }}</span>',
      "<span>{{ lane.target ?? '—' }}</span>",
      "meta: `${milestone.target} · ${word}`,",
    ])
      expect(one(text), text).toHaveLength(1);
  });

  test("a hit names its path, line, pattern and text", () => {
    expect(one("// prose\nconst y = now.getFullYear();")).toEqual([
      `${file}:2: date-part getter — const y = now.getFullYear();`,
    ]);
  });

  test("control: relative times, lists, whole ISO strings, keys and comments pass", () => {
    for (const text of [
      "const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });",
      "const list = new Intl.ListFormat(lang).format(names);",
      "protected readonly iso = computed(() => new Date(this.epoch()).toISOString());",
      "const elapsed = Date.now() - new Date(iso).getTime();",
      "return hash.slice(0, 12);",
      "id: `${key}:${value}`,",
      "// a comment may name Intl.DateTimeFormat to rule it out",
      "<!-- {{ target }} in a comment -->",
    ])
      expect(one(text), text).toEqual([]);
  });
});
