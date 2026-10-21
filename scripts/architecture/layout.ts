/**
 * Rule `layout` (spec 059, ISC-409): the folder shape of the entry's root.
 *
 * Directly in the root sit only the files `layout.topLevelFiles` names. Every folder of the root is either a shared
 * area (`layout.areas`) or a slice, and every slice has `layout.sliceEntry` directly inside it, its one public surface.
 * Folders nested inside a slice or an area are free. The rule sees the files `entryFiles` returns, so ignored files
 * (tests, generated files) neither count as strays nor make a folder a slice.
 */
import { join } from "node:path";

import type { LayoutConfig } from "../architecture.config.ts";
import type { Rule, Violation } from "./files.ts";
import { entryFiles, relPath } from "./files.ts";

/** Where a file of the root belongs: the root itself, a shared area or a slice. */
export type Placement = { kind: "top"; name: string } | { kind: "area"; name: string } | { kind: "slice"; name: string };

/** The placement of `path`, a file path relative to the root with `/` separators. */
export function placementOf(path: string, layout: LayoutConfig): Placement {
  const slash = path.indexOf("/");
  if (slash === -1) return { kind: "top", name: path };
  const folder = path.slice(0, slash);
  return layout.areas.includes(folder) ? { kind: "area", name: folder } : { kind: "slice", name: folder };
}

export const layout: Rule = (entry, repoRoot) => {
  const config = entry.layout;
  if (config === undefined) return [];
  const root = join(repoRoot, entry.root);
  const violations: Violation[] = [];
  const slices = new Map<string, boolean>();

  for (const file of entryFiles(entry, repoRoot)) {
    const path = relPath(root, file);
    const placement = placementOf(path, config);
    if (placement.kind === "top" && !config.topLevelFiles.includes(path)) {
      const allowed = config.topLevelFiles.length === 0 ? "no file" : `only ${config.topLevelFiles.join(", ")}`;
      violations.push({
        rule: "layout",
        file: relPath(repoRoot, file),
        detail: `outside every slice and area (${allowed} may sit directly in ${entry.root})`,
      });
    }
    if (placement.kind === "slice") {
      const hasEntry = slices.get(placement.name) === true || path === `${placement.name}/${config.sliceEntry}`;
      slices.set(placement.name, hasEntry);
    }
  }

  for (const [name, hasEntry] of [...slices].sort(([a], [b]) => a.localeCompare(b))) {
    if (!hasEntry) {
      violations.push({
        rule: "layout",
        file: relPath(repoRoot, join(root, name)),
        detail: `slice ${name} has no ${config.sliceEntry}`,
      });
    }
  }
  return violations;
};
