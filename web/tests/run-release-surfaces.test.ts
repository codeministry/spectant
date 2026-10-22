// Surface guard for "Release run" (spec 040, T62, ISC-226): the button writes, so it sits only where a run is looked
// at, never on a board card, which is one tap target and too narrow for a second 44 px one. This guard reads every
// component template under `web/src` (specs excluded) and fails when `<app-run-release` appears anywhere but the
// spec's status block and the detail sidebar (whose compact presentation is the mobile bottom sheet).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const ALLOWED = [
  "app/features/spec/status/status-block.html",
  "app/layout/detail-sidebar/detail-sidebar.html",
  // The sidebar's actions grid (spec 067, ISC-534) is part of the detail sidebar.
  "app/layout/detail-sidebar/sidebar-actions.html",
];

function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|html)$/.test(entry.name) && !entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("run release surfaces (T62, ISC-226)", () => {
  test("only the status block and the detail sidebar render app-run-release; no board card does", () => {
    const hosts = sources()
      .filter((path) => readFileSync(path, "utf8").includes("<app-run-release"))
      .map((path) => relative(SRC, path))
      .sort();
    expect(hosts).toEqual([...ALLOWED].sort());
  });
});
