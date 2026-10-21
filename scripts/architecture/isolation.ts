/**
 * Rule `isolation` (spec 061, ISC-431): no folder of the entry's feature area imports another folder of that area.
 *
 * The area is a top folder of the root (`isolation.area`, `features` for the web app); each folder directly under it
 * is one feature. A file of `features/board/` may import its own folder, any folder outside the area (`core/`,
 * `shared/`, `layout/`) and packages, never `features/planning/`: what two features share lives below them. Every
 * relative import of an area file that resolves to a file of another feature is one violation
 * `isolation <file>:<line> <feature> imports <other feature> (<target>)`. A file directly in the area belongs to no
 * folder; it counts as a feature of its own, named by its file, so it cannot carry what two features share.
 *
 * The importers are the `.ts` files under `<root>/<area>`, found by a walk of the area itself, not by the entry's file
 * list: the web entry leaves `features/**` out of size and duplicates while the features are split (spec 061), and
 * this rule must see them regardless. Only tests and generated files (`TEST_AND_GENERATED`) stay out, as for every
 * rule. The imports are the ones of the `imports` rule (`importEdges`): static, re-exports, side-effect, type-only and
 * dynamic `import('…')`, because a lazily loaded route of another feature couples the two as a static import does.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Rule, Violation } from "./files.ts";
import { entryFiles, relPath, TEST_AND_GENERATED } from "./files.ts";
import { importEdges } from "./imports.ts";

/** The feature of a path relative to the root: its folder under the area, or its file directly in the area. */
function featureOf(path: string, area: string): string | undefined {
  const prefix = `${area}/`;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

export const isolation: Rule = (entry, repoRoot) => {
  const area = entry.isolation?.area;
  if (area === undefined) return [];
  const root = join(repoRoot, entry.root);
  if (!existsSync(join(root, area))) return [];
  const areaEntry = { ...entry, root: join(entry.root, area), extensions: [".ts"], ignore: TEST_AND_GENERATED };
  const violations: Violation[] = [];
  for (const edge of importEdges(entryFiles(areaEntry, repoRoot), root)) {
    const from = featureOf(edge.from, area);
    const to = featureOf(edge.to, area);
    if (from === undefined || to === undefined || from === to) continue;
    violations.push({
      rule: "isolation",
      file: relPath(repoRoot, join(root, edge.from)),
      line: edge.line,
      detail: `${from} imports ${to} (${edge.to})`,
    });
  }
  return violations;
};
