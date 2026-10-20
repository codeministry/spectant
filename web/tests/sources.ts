// The app's own sources as the static guards read them (daisyUI collisions, CSS custom properties): stylesheets
// (`.css` files plus the inline `styles` of components) and templates (`.html` files plus inline `template`s and the
// `host` object), specs excluded. One reader, so every guard sees the same CSS and the same markup.
//
// An inline `styles` is read in both forms Angular takes, a single template literal and an array: every template
// literal in the array is read, and an identifier in it is read when it names a `*_STYLES` constant (such a constant
// is collected from every `.ts` file, wherever it is declared). A file that declares several components contributes
// every component's `styles` and `template`.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Source = { readonly file: string; readonly text: string };

/** Every file under `dir`, depth first. */
export function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/**
 * The template literals of the value after `key:` — a single literal, or every literal of an array up to its closing
 * bracket (brackets inside literals, such as attribute selectors, do not close it). Identifiers in an array are
 * returned as `{ ref }`.
 */
function literalsAfter(source: string, key: string): Array<string | { ref: string }> {
  const out: Array<string | { ref: string }> = [];
  for (const match of source.matchAll(new RegExp(`\\b${key}:\\s*([\`\\[])`, "gu"))) {
    let i = match.index + match[0].length;
    if (match[1] === "`") {
      const end = source.indexOf("`", i);
      out.push(source.slice(i, end));
      continue;
    }
    while (i < source.length && source[i] !== "]") {
      if (source[i] === "`") {
        const end = source.indexOf("`", i + 1);
        out.push(source.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      const ident = /^[A-Za-z_$][\w$]*/u.exec(source.slice(i));
      if (ident !== null) {
        out.push({ ref: ident[0] });
        i += ident[0].length;
        continue;
      }
      i += 1;
    }
  }
  return out;
}

/** Template literals assigned to a `*_STYLES` constant, keyed by name. */
function styleConstants(files: readonly string[]): Map<string, string> {
  const consts = new Map<string, string>();
  for (const path of files) {
    if (!path.endsWith(".ts") || path.endsWith(".spec.ts")) continue;
    for (const m of readFileSync(path, "utf8").matchAll(/\b([A-Z][A-Z0-9_]*_STYLES)\s*=\s*`([\s\S]*?)`/gu)) consts.set(m[1] ?? "", m[2] ?? "");
  }
  return consts;
}

/** Own stylesheets under `dir`: `.css` files and the inline `styles` of components, specs excluded. */
export function stylesheets(dir: string, base: string): Source[] {
  const files = walk(dir);
  const consts = styleConstants(files);
  return files.flatMap((path) => {
    const file = relative(base, path);
    if (path.endsWith(".css")) return [{ file, text: readFileSync(path, "utf8") }];
    if (!path.endsWith(".ts") || path.endsWith(".spec.ts")) return [];
    const css = literalsAfter(readFileSync(path, "utf8"), "styles").map((part) => (typeof part === "string" ? part : (consts.get(part.ref) ?? "")));
    return css.length === 0 ? [] : [{ file, text: css.join("\n") }];
  });
}

/** Own templates under `dir`: `.html` files and the inline `template` and `host` object of components, specs excluded. */
export function templates(dir: string, base: string): Source[] {
  return walk(dir).flatMap((path) => {
    const file = relative(base, path);
    if (path.endsWith(".html")) return [{ file, text: readFileSync(path, "utf8") }];
    if (!path.endsWith(".ts") || path.endsWith(".spec.ts")) return [];
    const source = readFileSync(path, "utf8");
    const parts = literalsAfter(source, "template").filter((part): part is string => typeof part === "string");
    // The host object holds no nested braces in this app; its `class` and `[class.x]` / `[style.--x]` keys are markup.
    parts.push(...[...source.matchAll(/\bhost:\s*\{([^}]*)\}/gu)].map((m) => m[1] ?? ""));
    return parts.length === 0 ? [] : [{ file, text: parts.join("\n") }];
  });
}
