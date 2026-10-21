/**
 * Rule `layers` (spec 060, ISC-424): a layer of the entry's root imports only the layers before it in `layers.order`.
 *
 * A layer is a top folder of the root that `layers.order` names, lowest first (`core`, `shared`, `layout`, `features`
 * for the web app): a file of `shared/` may import `core/` and `shared/`, never `layout/` or `features/`. Every
 * relative import of an entry file that resolves to a file of a later layer is one violation
 * `layers <file>:<line> <layer> imports <later layer> (<target>)`.
 *
 * The importers are the entry's `.ts` files (templates and stylesheets import no module) that sit in a layer; a file
 * directly in the root (`app.ts`, `app.routes.ts`) or in a folder the order leaves out is not checked. The targets are
 * every file under the root, the entry's ignored folders included, so an ignored `features/` still counts as the top
 * layer. The imports are the ones of the `imports` rule (`importEdges`): static, re-exports, side-effect, dynamic and
 * type-only, because a type reached in a higher layer couples the lower one to it just as a value does.
 */
import { join } from "node:path";

import type { Rule, Violation } from "./files.ts";
import { entryFiles, relPath } from "./files.ts";
import { importEdges } from "./imports.ts";

/** The layer of a path relative to the root: its top folder, or undefined for a file directly in the root. */
function layerOf(path: string): string | undefined {
  const slash = path.indexOf("/");
  return slash === -1 ? undefined : path.slice(0, slash);
}

export const layers: Rule = (entry, repoRoot) => {
  const order = entry.layers?.order;
  if (order === undefined) return [];
  const root = join(repoRoot, entry.root);
  const rank = (path: string): number => {
    const layer = layerOf(path);
    return layer === undefined ? -1 : order.indexOf(layer);
  };
  const files = entryFiles(entry, repoRoot).filter((file) => file.endsWith(".ts"));
  const violations: Violation[] = [];
  for (const edge of importEdges(files, root)) {
    const from = rank(edge.from);
    if (from === -1 || rank(edge.to) <= from) continue;
    violations.push({
      rule: "layers",
      file: relPath(repoRoot, join(root, edge.from)),
      line: edge.line,
      detail: `${layerOf(edge.from) ?? ""} imports ${layerOf(edge.to) ?? ""} (${edge.to})`,
    });
  }
  return violations;
};
