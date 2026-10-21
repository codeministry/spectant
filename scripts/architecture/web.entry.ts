/**
 * The web lane's entry for `scripts/check-architecture.ts` (spec 060, ISC-423, ISC-424).
 *
 * The Angular app under `web/src/app`: components, their templates and their stylesheets, each at most 400 lines and
 * without a copied block of 50 tokens or more (jscpd `typescript`, `markup` and `css`), and the layers core ← shared ←
 * layout ← features (`layers`). The entry lives in a file of its own, so the fixture configurations of the tests load
 * it without the server entry; `scripts/architecture.config.ts` lists it, and `bun run check:static` runs it.
 */
import type { IsolationConfig, LaneEntry } from "../architecture.config.ts";
import { TEST_AND_GENERATED } from "./files.ts";

/**
 * The web entry's feature area for the `isolation` rule (spec 061, ISC-431): no folder under `features/` imports
 * another, statically, type-only or through a dynamic `import()`.
 */
export const webIsolation: IsolationConfig = { area: "features" };

export const web: LaneEntry = {
  name: "web",
  root: "web/src/app",
  extensions: [".ts", ".html", ".css"],
  // `features/**` stays out of size and duplicates until the third spec of the feature splits it, and that spec
  // removes this pattern; `layers` still resolves imports into it. `dev/**` (the developer gallery) is no base
  // layer: ISC-423 covers core/, shared/ and layout/ only (spec 060 decision 2026-10-21).
  ignore: [...TEST_AND_GENERATED, "features/**", "dev/**"],
  isolation: webIsolation,
  size: { maxLines: 400 },
  duplicates: {
    minTokens: 50,
    allow: [
      {
        files: ["layout/assistant/assistant-panel.css", "layout/detail-sidebar/detail-sidebar.css"],
        why:
          "four surface declarations on two different selectors (.as-panel, .panel); " +
          "no shared rule without a DOM change (spec 060 decision 2026-10-21)",
      },
    ],
  },
  layers: { order: ["core", "shared", "layout", "features"] },
};
