/**
 * Rule `io` (spec 059, ISC-411): direct I/O only inside the folders `io.allowedIn` names (`infra/` for the server).
 *
 * Every file of the entry outside those folders, the top-level files included, is checked for two things:
 * - an import of a module `io.modules` lists, as `Bun.Transpiler.scanImports` reports it: static imports, re-exports,
 *   side-effect imports, dynamic `import()` and `require()`, and the type-only forms too (`import type { Database }
 *   from "bun:sqlite"`), so a slice reaches even the types of an I/O module through `infra/`. A listed `node:` module
 *   also matches its bare form (`fs/promises` for `node:fs/promises`), which Bun resolves to the same module.
 *   Reported once per file and module, at the first line that names it.
 * - a use of a member `io.calls` lists (`Bun.spawn`, `Bun.file`, `Bun.write`): the member access itself, called or
 *   not (`Bun.file(path)`, `Bun?.file`, `const read = Bun.file`), and a destructuring of the member out of its object
 *   (`const { spawn } = Bun`). Reported at every occurrence. The search runs on the source with every comment, string
 *   and template text and regex literal blanked out (`blankSource`), so a mention in a doc comment or a message is not
 *   a call. Not caught: a computed access (`Bun["file"]`) and an alias of the object (`const B = Bun; B.file()`).
 *
 * The folder of a file is the first folder of its path under the root, as `placementOf` names it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Rule, Violation } from "./files.ts";
import { entryFiles, relPath } from "./files.ts";
import { withTypeImports } from "./imports.ts";
import { placementOf } from "./layout.ts";

const transpiler = new Bun.Transpiler({ loader: "ts" });

/** Keywords after which a `/` starts a regex literal rather than a division. */
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

/** Characters after which a `/` starts a regex literal rather than a division. */
const REGEX_AFTER_CHAR = /^[(,=:[!&|?{};+\-*%<>~^]$/;

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\w$]/.test(char);

/**
 * `source` with every comment blanked out, and with `strings` also the text of every string, template and regex
 * literal (the delimiters and template `${…}` expressions stay). Blanked characters become spaces and line breaks stay,
 * so offsets and line numbers match the original. A lexer, not a parser: a `/` is a regex when the code before it ends
 * in an operator, an opening bracket or a keyword like `return`, as in hand-written TypeScript.
 */
export function blankSource(source: string, strings: boolean): string {
  // One entry per UTF-16 code unit, so an index into `out` is an index into `source`.
  const out = Array.from({ length: source.length }, (_, k) => source.charAt(k));
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i += 1) if (out[i] !== "\n") out[i] = " ";
  };
  /** Brace depth inside each open template `${…}` expression, innermost last. */
  const templates: number[] = [];
  let lastChar: string | undefined;
  let lastWord = "";
  let i = 0;

  /** Scans template text from `i` to its closing backtick or the next `${`, blanking the text when `strings`. */
  const templateText = (): void => {
    const start = i;
    while (i < source.length && source[i] !== "`" && !(source[i] === "$" && source[i + 1] === "{")) {
      i += source[i] === "\\" ? 2 : 1;
    }
    if (strings) blank(start, Math.min(i, source.length));
    lastWord = "";
    if (source[i] === "`") {
      i += 1;
      lastChar = "`";
    } else if (i < source.length) {
      templates.push(0);
      i += 2;
      lastChar = "{";
    }
  };

  while (i < source.length) {
    const char = source[i] ?? "";
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      blank(i, end === -1 ? source.length : end + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== char && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      if (strings) blank(i + 1, Math.min(j, source.length));
      i = j + 1;
      lastChar = char;
      lastWord = "";
    } else if (char === "`") {
      i += 1;
      templateText();
    } else if (char === "}" && templates.length > 0 && templates[templates.length - 1] === 0) {
      templates.pop();
      i += 1;
      templateText();
    } else if (char === "/" && (lastChar === undefined || REGEX_AFTER_CHAR.test(lastChar) || REGEX_AFTER_WORD.has(lastWord))) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== "\n" && (inClass || source[j] !== "/")) {
        if (source[j] === "\\") j += 1;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        j += 1;
      }
      if (strings) blank(i + 1, Math.min(j, source.length));
      i = j + 1;
      lastChar = "/";
      lastWord = "";
    } else {
      if (templates.length > 0 && (char === "{" || char === "}")) {
        const depth = templates.pop() ?? 0;
        templates.push(char === "{" ? depth + 1 : depth - 1);
      }
      if (!/\s/.test(char)) {
        if (isWordChar(char)) lastWord = isWordChar(lastChar) ? lastWord + char : char;
        else lastWord = "";
        lastChar = char;
      }
      i += 1;
    }
  }
  return out.join("");
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The 1-based line of `offset` in `source`. */
function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

/** The listed module `specifier` names, matching a `node:` module's bare form too, or undefined. */
function listedModule(specifier: string, modules: string[]): string | undefined {
  return modules.find((module) => specifier === module || `node:${specifier}` === module);
}

/** Every import of a listed module in `source`: the module as listed, as written, and its first line outside comments. */
function moduleHits(source: string, modules: string[]): Array<{ line: number; detail: string }> {
  const code = blankSource(source, false);
  const specifiers = [...new Set(transpiler.scanImports(withTypeImports(source)).map((item) => item.path))];
  return specifiers.flatMap((specifier) => {
    const module = listedModule(specifier, modules);
    if (module === undefined) return [];
    const pattern = new RegExp(`["'\`]${escapeRegExp(specifier)}["'\`]`);
    const match = pattern.exec(code);
    const detail = specifier === module ? module : `${specifier} (${module})`;
    return [{ line: match === null ? 1 : lineAt(code, match.index), detail }];
  });
}

/** Every use of a listed `object.member` in `source`, comments, strings and regex literals left out. */
function callHits(source: string, calls: string[]): Array<{ line: number; detail: string }> {
  const code = blankSource(source, true);
  const hits: Array<{ offset: number; detail: string }> = [];
  for (const call of calls) {
    const dot = call.lastIndexOf(".");
    const object = escapeRegExp(call.slice(0, dot));
    const member = escapeRegExp(call.slice(dot + 1));
    const access = new RegExp(`(?<![\\w$.])${object}\\s*\\??\\.\\s*${member}(?![\\w$])`, "g");
    for (const match of code.matchAll(access)) hits.push({ offset: match.index, detail: call });
    const destructure = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${object}(?![\\w$.])`, "g");
    const key = new RegExp(`(?<![\\w$])${member}\\s*(?=[:,}=]|$)`);
    for (const match of code.matchAll(destructure)) {
      if (key.test(match[1] ?? "")) hits.push({ offset: match.index, detail: call });
    }
  }
  return hits.sort((a, b) => a.offset - b.offset).map((hit) => ({ line: lineAt(code, hit.offset), detail: hit.detail }));
}

export const io: Rule = (entry, repoRoot) => {
  const config = entry.io;
  if (config === undefined) return [];
  const layout = entry.layout ?? { topLevelFiles: [], areas: [], sliceEntry: "index.ts" };
  const root = join(repoRoot, entry.root);
  const violations: Violation[] = [];

  for (const file of entryFiles(entry, repoRoot)) {
    const placement = placementOf(relPath(root, file), layout);
    if (placement.kind !== "top" && config.allowedIn.includes(placement.name)) continue;
    const source = readFileSync(file, "utf8");
    const hits = [...moduleHits(source, config.modules), ...callHits(source, config.calls)];
    for (const hit of hits.sort((a, b) => a.line - b.line)) {
      violations.push({ rule: "io", file: relPath(repoRoot, file), line: hit.line, detail: hit.detail });
    }
  }
  return violations;
};
