#!/usr/bin/env bun
/**
 * check-single-core — ISC-5: the spec format is parsed in exactly one place, `core/`.
 *
 * Usage: bun run check:single-core            (scans the repository this script lives in)
 *        bun scripts/check-single-core.ts DIR  (scans DIR instead; used to exercise the heuristics)
 *
 * Walks `server/`, `web/`, `scripts/`, `plugin/` and `tests/` and reports every code line that looks like a
 * second parser of the spec format. Top-level `core/` is exempt because it is never walked; a directory called
 * `core` anywhere else is scanned like any other, so the exemption cannot be borrowed.
 *
 * Why: two parsers drift, and a drifted stage or claim count is a wrong dashboard nobody notices. Every other
 * lane imports `@spectant/core` (or a relative `core/` path) instead. Import and re-export statements are
 * never inspected, so importing is always the allowed way.
 *
 * Heuristics, each named after the failure it prevents:
 *
 *   frontmatter   A second frontmatter reader. Hits a RegExp whose pattern contains `---` (`/^---\n/`,
 *                 `/^---$/m`), a search or split call with a `---` string (`text.split("---")`,
 *                 `src.startsWith("---")`), and a line compared to `"---"` (`line === "---"`, `case "---":`).
 *   claim-line    A second claim or task reader. Hits a RegExp that matches variable claim IDs (`ISC-\d`,
 *                 `ISC-[0-9]`, `ISC-(`) or a checkbox (`- \[[ x]\]`, `\[\s*x\s*\]`), and a search call with a
 *                 checkbox string (`line.startsWith("- [ ]")`).
 *   stage         A second stage or next-command derivation. Hits a definition (function, const/let/var,
 *                 method, object property) of `stageOf`, `nextCommand` or `deriveStage`. Aliasing an
 *                 imported one (`const stageOf = core.stageOf`) is not a definition and is not reported.
 *   test-strategy A second Test Strategy reader. Hits a search call or RegExp naming "Test Strategy", and, in a
 *                 file that mentions `.md`, markdown or Test Strategy, a `.split` on `|` (a `"|"` string or a regex of only `\|` and optional `\s`).
 *
 * The heuristics are line-based and deliberately coarse: a false positive costs one comment, a silent second
 * parser costs a wrong dashboard. Comment lines are skipped, and generated files (`*.gen.*`) are skipped
 * because they embed build output, which legitimately contains compiled `core/`; their sources are scanned.
 *
 * Suppression: a trailing `// single-core: allow — <reason>` on the offending line suppresses its hits and is
 * counted as "allowed" in the summary. An allow comment without a reason suppresses nothing.
 *
 * Output: one `path:line: reason` per hit on stderr and exit 1; otherwise
 * `single-core: 0 hits, N files scanned (M allowed)` on stdout and exit 0. Paths are relative to the root.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const SCAN_ROOTS = ["server", "web", "scripts", "plugin", "tests"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".angular", "coverage"]);
const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const GENERATED_FILE = /\.gen\.(?:[cm]?[jt]s|[jt]sx)$/;

const ALLOW_MARK = /\/\/\s*single-core:\s*allow\b(.*)$/;
const ALLOW_REASON = /^\s*(?:—|–|--?|:)\s*\S/;

/** A regex literal after a token that cannot end an expression (so `a / b / c` is not one). */
const REGEX_LITERAL = /(?:^|[=(,:[!&|?{};+]|\breturn|\btypeof)\s*\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\[\n])+)\/[dgimsuyv]*/g;
/** `new RegExp("…")` or `RegExp('…')`; the string body is unescaped once to compare with a literal body. */
const REGEXP_CTOR = /\bRegExp\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
/** A search, split or replace call whose first argument is a plain string. */
const STRING_CALL =
  /\.(split|startsWith|endsWith|indexOf|lastIndexOf|includes|match|matchAll|search|replace|replaceAll)\(\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2/g;
/** A value compared with, or a `case` on, a string made only of the frontmatter delimiter. */
const DELIMITER_COMPARE = /(?:[=!]==?\s*|\bcase\s+)(["'`])---(?:\\r)?(?:\\n)?\1|(["'`])---(?:\\r)?(?:\\n)?\2\s*[=!]==?/; // single-core: allow — detector pattern

const FRONTMATTER_PATTERN = /---|-\{3|(?:\\-){3}/; // single-core: allow — detector pattern
const CLAIM_ID_PATTERN = /ISC-(?:\\|\[|\()/; // single-core: allow — detector pattern
const CHECKBOX_PATTERN = /\\\[((?:\\s[*+?]?|\[[ xX\\s]*\][*+?]?|[ xX][*+?]?)+)\\\]/; // single-core: allow — detector pattern
const CHECKBOX_STRING = /\[[ xX]\]/; // single-core: allow — detector pattern
const TEST_STRATEGY = /test\s*strategy/i;
const PIPE_PATTERN = /^(?:\\s[*+?]?)*\\\|(?:\\s[*+?]?)*$/;
const MD_CONTEXT = /\.md\b|markdown|test\s*strategy/i;

const STAGE_NAMES = "stageOf|nextCommand|deriveStage";
const STAGE_DEFINITIONS = [
  new RegExp(`\\bfunction\\s*\\*?\\s*(?:${STAGE_NAMES})\\b`),
  new RegExp(`\\b(?:const|let|var)\\s+(?:${STAGE_NAMES})\\b\\s*(?::[^=]+)?=\\s*(?!\\s*(?:await\\s+import\\(|require\\(|[\\w$.]+\\s*;?\\s*(?:\\/\\/.*)?$))`),
  new RegExp(`(?:^|[{;}])\\s*(?:(?:export|default|async|static|public|private|protected|override|readonly)\\s+)*(?:${STAGE_NAMES})\\s*(?:<[^>]*>)?\\(.*\\)\\s*(?::[^{]+)?\\{`),
  new RegExp(`\\b(?:${STAGE_NAMES})\\s*[:=]\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|[\\w$]+\\s*=>)`),
];

const IMPORT_START = /^\s*(?:import\b(?!\s*\()|export\s+(?:type\s+)?(?:\*|\{))/;
const IMPORT_END = /\bfrom\s*["'`]|^\s*import\s*["'`]/;

type Hit = { path: string; line: number; reason: string };

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && CODE_FILE.test(entry.name) && !GENERATED_FILE.test(entry.name)) yield full;
  }
}

/** Pattern sources on a line: regex literal bodies and RegExp constructor strings (unescaped once). */
function patternsOf(line: string): string[] {
  const found: string[] = [];
  for (const m of line.matchAll(REGEX_LITERAL)) found.push(m[1]);
  for (const m of line.matchAll(REGEXP_CTOR)) found.push(m[2].replace(/\\\\/g, "\\"));
  return found;
}

function reasonsFor(line: string, mdContext: boolean): string[] {
  const reasons = new Set<string>();
  const patterns = patternsOf(line);

  for (const p of patterns) {
    if (FRONTMATTER_PATTERN.test(p)) reasons.add("frontmatter: RegExp matches the `---` delimiter");
    if (CLAIM_ID_PATTERN.test(p)) reasons.add("claim-line: RegExp matches variable claim IDs (ISC-…)");
    if (CHECKBOX_PATTERN.test(p)) reasons.add("claim-line: RegExp matches a checkbox line");
    if (TEST_STRATEGY.test(p)) reasons.add("test-strategy: RegExp locates the Test Strategy table");
  }

  for (const m of line.matchAll(STRING_CALL)) {
    const [, method, , arg] = m;
    if (arg.includes("---")) reasons.add(`frontmatter: .${method}() on the \`---\` delimiter`); // single-core: allow — detector pattern
    if (CHECKBOX_STRING.test(arg)) reasons.add(`claim-line: .${method}() on a checkbox string`);
    if (TEST_STRATEGY.test(arg)) reasons.add(`test-strategy: .${method}() locates the Test Strategy table`);
    if (method === "split" && arg === "|" && mdContext) reasons.add("test-strategy: .split() on `|` in a markdown context");
  }
  if (mdContext && /\.split\(/.test(line)) {
    for (const m of line.matchAll(/\.split\(\s*\/((?:\\.|[^/\\\n])+)\//g)) {
      if (PIPE_PATTERN.test(m[1])) reasons.add("test-strategy: .split() on `|` in a markdown context");
    }
  }

  if (DELIMITER_COMPARE.test(line)) reasons.add("frontmatter: compares a line with the `---` delimiter");
  if (STAGE_DEFINITIONS.some((re) => re.test(line))) reasons.add("stage: defines stageOf, nextCommand or deriveStage");

  return [...reasons];
}

function scanFile(file: string, root: string, hits: Hit[]): number {
  const path = relative(root, file).split(sep).join("/");
  const text = readFileSync(file, "utf8");
  const mdContext = MD_CONTEXT.test(text);
  let allowed = 0;
  let inBlockComment = false;
  let inImport = false;

  text.split("\n").forEach((raw, index) => {
    const trimmed = raw.trim();
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      return;
    }
    if (trimmed.startsWith("/*")) {
      inBlockComment = !trimmed.includes("*/");
      return;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    if (inImport) {
      if (IMPORT_END.test(raw)) inImport = false;
      return;
    }
    if (IMPORT_START.test(raw)) {
      inImport = !IMPORT_END.test(raw) && !/;\s*$/.test(raw);
      return;
    }

    const allow = raw.match(ALLOW_MARK);
    const code = allow ? raw.slice(0, allow.index) : raw;
    const reasons = reasonsFor(code, mdContext);
    if (reasons.length === 0) return;

    if (allow && ALLOW_REASON.test(allow[1])) {
      allowed += reasons.length;
      return;
    }
    const suffix = allow ? " (allow comment has no reason)" : "";
    for (const reason of reasons) hits.push({ path, line: index + 1, reason: reason + suffix });
  });

  return allowed;
}

function main(): number {
  const root = resolve(process.argv[2] ?? join(import.meta.dir, ".."));
  const hits: Hit[] = [];
  let files = 0;
  let allowed = 0;

  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      files += 1;
      allowed += scanFile(file, root, hits);
    }
  }

  const summary = `single-core: ${hits.length} hits, ${files} files scanned (${allowed} allowed)`;
  if (hits.length === 0) {
    console.log(summary);
    return 0;
  }
  for (const hit of hits) console.error(`${hit.path}:${hit.line}: ${hit.reason}`);
  console.error(summary);
  console.error("single-core: parse the spec format in core/ and import @spectant/core instead (ISC-5).");
  return 1;
}

process.exit(main());
