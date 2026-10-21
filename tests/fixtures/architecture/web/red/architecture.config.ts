/**
 * Fixture configuration for the web entry (spec 060, ISC-423): the web entry of `scripts/architecture/web.entry.ts`
 * over a fixture root, whose 401-line stylesheet `size` flags and whose block copied
 * between two templates `duplicates` flags; the same files under `dev/` are ignored (spec 061 checks `features/`).
 */
import type { ArchitectureConfig } from "../../../../../scripts/architecture.config.ts";
import { web } from "../../../../../scripts/architecture/web.entry.ts";

const config: ArchitectureConfig = {
  lanes: [{ ...web, name: "fixture-web-red", root: "tests/fixtures/architecture/web/red/src" }],
};

export default config;
