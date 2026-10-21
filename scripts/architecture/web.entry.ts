/**
 * The web lane's entry for `scripts/check-architecture.ts` (spec 060, ISC-423, ISC-424).
 *
 * The Angular app under `web/src/app`: components, their templates and their stylesheets, each at most 400 lines and
 * without a copied block of 50 tokens or more (jscpd `typescript`, `markup` and `css`), and the layers core ← shared ←
 * layout ← features (`layers`). The entry lives in a file of its own until the base layers keep every rule; then
 * `scripts/architecture.config.ts` adds it to its lanes and `bun run check:static` runs it.
 */
import type { LaneEntry } from "../architecture.config.ts";
import { TEST_AND_GENERATED } from "./files.ts";

export const web: LaneEntry = {
  name: "web",
  root: "web/src/app",
  extensions: [".ts", ".html", ".css"],
  // `features/**` stays out of size and duplicates until the third spec of the feature splits it, and that spec
  // removes this pattern; `layers` still resolves imports into it.
  ignore: [...TEST_AND_GENERATED, "features/**"],
  size: { maxLines: 400 },
  duplicates: { minTokens: 50 },
  layers: { order: ["core", "shared", "layout", "features"] },
};
