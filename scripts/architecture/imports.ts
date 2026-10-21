/**
 * Rule `imports` (spec 059, ISC-410): the import graph between the slices and areas of the entry's root.
 *
 * Three clauses, each switched by `imports`:
 * - `sliceEntryOnly`: a slice imports another slice only through that slice's entry file (`layout.sliceEntry`);
 * - `areasImportNoSlice`: no shared area (`layout.areas`) imports a slice, not even through its entry;
 * - `noSliceCycles`: no cycle between slices, reported once per strongly connected group of slices, with the shortest
 *   cycle through its first slice as the path.
 *
 * Slices and areas are the ones `layout` names (`placementOf`). A file directly in the root that `layout.topLevelFiles`
 * names (`main.ts`) may import anything. Any other file directly in the root is a stray that the layout rule reports;
 * here it counts as a slice of its own that has no entry file, so every import into it from another slice is a deep
 * import and it takes part in cycles. A flat root therefore fails this rule as it fails `layout`.
 *
 * The graph holds every relative import that resolves to a file under the root: static imports, re-exports,
 * side-effect imports, dynamic `import()` and `require()`, as `Bun.Transpiler.scanImports` reports them, and the
 * type-only ones too (`import type`, `export type … from`, `{ type X }`), which the transpiler alone would drop: a type
 * reached past a slice's entry file widens its public surface just as a value does. Bare specifiers (packages,
 * `node:` and `bun:` modules) and imports that leave the root are not part of the graph.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { LayoutConfig } from "../architecture.config.ts";
import type { Rule, Violation } from "./files.ts";
import { entryFiles, relPath } from "./files.ts";
import { placementOf, type Placement } from "./layout.ts";

/** One resolved import: the importing file and the imported one, both relative to the root, and the import's line. */
export type ImportEdge = { from: string; to: string; line: number };

const transpiler = new Bun.Transpiler({ loader: "ts" });

/** `source` with every type-only import turned into a value import, so `scanImports` keeps it. */
function withTypeImports(source: string): string {
  return source
    .replace(/\bimport\s+type\s+/g, "import ")
    .replace(/\bexport\s+type\s+(?=[{*])/g, "export ")
    .replace(/([{,]\s*)type\s+(?=[A-Za-z_$])/g, "$1");
}

/** The relative specifiers `source` imports, type-only imports included, in source order and without repeats. */
export function importSpecifiers(source: string): string[] {
  const paths = transpiler.scanImports(withTypeImports(source)).map((item) => item.path);
  return [...new Set(paths)].filter((path) => path.startsWith("./") || path.startsWith("../"));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The file `specifier` names from `file`, as Bun resolves a relative path: as written, with `.ts`, or its `index.ts`. */
function resolveSpecifier(file: string, specifier: string): string | undefined {
  const base = resolve(dirname(file), specifier);
  return [base, `${base}.ts`, join(base, "index.ts")].find(isFile);
}

/** The 1-based line of the first quoted occurrence of `specifier` in `source`. */
function lineOf(source: string, specifier: string): number {
  const quoted = ['"', "'", "`"].map((quote) => `${quote}${specifier}${quote}`);
  const index = source.split("\n").findIndex((text) => quoted.some((q) => text.includes(q)));
  return index + 1;
}

/** Every import of the entry's files that resolves to a file under its root. */
export function importEdges(files: string[], root: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const target = resolveSpecifier(file, specifier);
      if (target === undefined) continue;
      const to = relPath(root, target);
      if (to.startsWith("../")) continue;
      edges.push({ from: relPath(root, file), to, line: lineOf(source, specifier) });
    }
  }
  return edges;
}

/** The placement of a file for this rule: a stray top-level file is a slice of its own, named by the file. */
function unitOf(path: string, layout: LayoutConfig): Placement {
  const placement = placementOf(path, layout);
  if (placement.kind === "top" && !layout.topLevelFiles.includes(path)) return { kind: "slice", name: path };
  return placement;
}

/** The cycles of a directed graph, one per strongly connected component of more than one node, each as a node path. */
export function cyclesOf(graph: Map<string, Set<string>>): string[][] {
  const nodes = [...graph.keys()].sort();
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const connect = (node: string): void => {
    index.set(node, index.size);
    low.set(node, index.get(node) ?? 0);
    stack.push(node);
    onStack.add(node);
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (!index.has(next)) {
        connect(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1) components.push(component.sort());
  };

  for (const node of nodes) if (!index.has(node)) connect(node);
  return components.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")).map((c) => shortestCycle(graph, c));
}

/** The shortest cycle through the first node of `component`, staying inside it, closed by that node again. */
function shortestCycle(graph: Map<string, Set<string>>, component: string[]): string[] {
  const start = component[0] ?? "";
  const inside = new Set(component);
  const previous = new Map<string, string>();
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift() ?? start;
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (!inside.has(next)) continue;
      if (next === start) {
        const path = [node];
        while (path[0] !== start) path.unshift(previous.get(path[0] ?? start) ?? start);
        return [...path, start];
      }
      if (previous.has(next)) continue;
      previous.set(next, node);
      queue.push(next);
    }
  }
  return [start, start];
}

export const imports: Rule = (entry, repoRoot) => {
  const config = entry.imports;
  if (config === undefined) return [];
  const layout = entry.layout ?? { topLevelFiles: [], areas: [], sliceEntry: "index.ts" };
  const root = join(repoRoot, entry.root);
  const at = (path: string): string => relPath(repoRoot, join(root, path));
  const violations: Violation[] = [];
  const graph = new Map<string, Set<string>>();
  const witness = new Map<string, ImportEdge>();

  for (const edge of importEdges(entryFiles(entry, repoRoot), root)) {
    const from = unitOf(edge.from, layout);
    const to = unitOf(edge.to, layout);
    if (from.kind === "top" || to.kind !== "slice" || (from.kind === to.kind && from.name === to.name)) continue;
    if (from.kind === "area") {
      if (config.areasImportNoSlice) {
        violations.push({
          rule: "imports",
          file: at(edge.from),
          line: edge.line,
          detail: `area ${from.name} imports slice ${to.name} (${edge.to})`,
        });
      }
      continue;
    }
    const sliceEntry = `${to.name}/${layout.sliceEntry}`;
    if (config.sliceEntryOnly && edge.to !== sliceEntry) {
      violations.push({
        rule: "imports",
        file: at(edge.from),
        line: edge.line,
        detail: `slice ${from.name} imports ${edge.to}, not ${sliceEntry}`,
      });
    }
    graph.set(from.name, (graph.get(from.name) ?? new Set()).add(to.name));
    if (!graph.has(to.name)) graph.set(to.name, new Set());
    const key = `${from.name}\n${to.name}`;
    if (!witness.has(key)) witness.set(key, edge);
  }

  if (config.noSliceCycles) {
    for (const cycle of cyclesOf(graph)) {
      const first = witness.get(`${cycle[0] ?? ""}\n${cycle[1] ?? ""}`);
      violations.push({
        rule: "imports",
        file: first === undefined ? at(cycle[0] ?? "") : at(first.from),
        ...(first === undefined ? {} : { line: first.line }),
        detail: `cycle between slices ${cycle.join(" → ")}`,
      });
    }
  }
  return violations;
};
